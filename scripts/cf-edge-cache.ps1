param(
    # Zone > Cache Rules > Edit + Account Rulesets > Edit + Account Filter Lists > Edit
    # wrangler 登录拿到的 OAuth token 没有这三个权限（scopes 里只有 zone:read），所以写操作要单独给。
    [string]$Token = $env:CF_API_TOKEN,
    [string]$ZoneId = "372d8d6a756a303332bca3de2c4e0ec9",   # onestarry.com（zone:read 可查，status=active）
    [switch]$Apply,      # 建/改规则（默认只打印计划，不写）
    [switch]$Rollback,   # 删掉本脚本自己加的那条规则
    [switch]$Verify      # 连打三条路由看 cf-cache-status 与 TTFB（只读，不需要写权限）
)

$ErrorActionPreference = "Stop"
$BASE = "https://api.cloudflare.com/client/v4"
$PHASE = "http_request_cache_settings"
$DESC = "onestarry-ISR-html"   # 规则的唯一标识：脚本靠它认出并只动自己这一条，别人的规则一律原样带回

$HDRS = @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" }

# ── 要建的规则 ──────────────────────────────────────────────────────────────────
# 表达式三道收严，都是有实测依据的：
#  1) 只 GET/HEAD：purge/其它方法不进来。
#  2) PDP 用「匹配 /products/* 但不匹配 /products/*/*」来表达"恰好一段 slug"：
#     /products/<slug>/review 是登录页（307），/products/ 带尾斜杠是 308 —— 都不该进边缘缓存。
#     ⚠ 这里用 wildcard 而不是正则 matches：matches 在 Free 计划不开放（实测报错
#     "not entitled: the use of operator Matches is not allowed, a Business plan or a WAF Advanced plan is required"）。
#     wildcard 的 * 会跨着匹配 /，所以两条叠加就是“恰好一段”。
#  3) 排除探针 UA：jobs 的 ISR 探针（UA=onestarry-isr-probe）每 5 分钟打这三条路由来触发源站刷新
#     并读 origin 的 x-nextjs-cache。被 CDN 接住的话 R2 条目会变冷、探针 verdict 会失真。
# edge_ttl 用 bypass_by_default（不是 respect_origin）：
#     respect_origin 在"响应没有 cache-control"时退回 Cloudflare 默认（≈4.5h）。
#     而动态页正是没有 cache-control 的 —— 将来谁在这三条路由里加了 cookies()，页面变动态，
#     respect_origin 就会把某个人的页面缓存四个半小时发给所有人。
#     bypass_by_default = 只有源站显式写了 TTL 的响应才进 CDN；我们的 ISR 响应一定会写
#     （fixISRHeaders：HIT 给剩余新鲜度 s-maxage，STALE 给 s-maxage=2 + stale-while-revalidate）。
# browser_ttl 用 respect_origin：源站只写 s-maxage 不写 max-age，浏览器本来就不该缓存。
#     不设这一条的话 Cloudflare 会按规则自己的 Browser Cache TTL 改写发给浏览器的头（默认数小时），
#     回访用户会长时间看到旧页，而且请求根本不到我们这儿。
$RULE = [ordered]@{
    expression        = '(http.request.method eq "GET" or http.request.method eq "HEAD") ' +
        'and (http.request.uri.path eq "/" or http.request.uri.path eq "/products" ' +
        'or (http.request.uri.path wildcard "/products/*" and not http.request.uri.path wildcard "/products/*/*")) ' +
        'and not http.user_agent eq "onestarry-isr-probe"'
    description       = $DESC
    action            = "set_cache_settings"
    action_parameters = [ordered]@{
        cache       = $true
        edge_ttl    = @{ mode = "bypass_by_default" }
        browser_ttl = @{ mode = "respect_origin" }
    }
}

function Invoke-Cf([string]$Method, [string]$Uri, $Body) {
    # PS 5.1 没有 -SkipHttpErrorCheck：4xx 必须把响应体读出来才知道是 9109（没权限）还是 1009（资源不存在）。
    # 异常消息里固定带上状态码，上层靠它区分（中文系统的本地化文案不可依赖）。
    try {
        if ($null -ne $Body) {
            return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $HDRS -Body ($Body | ConvertTo-Json -Depth 12 -Compress)
        }
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $HDRS
    } catch {
        $resp = $_.Exception.Response
        if ($null -eq $resp) { throw }
        $code = [int]$resp.StatusCode
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $text = $reader.ReadToEnd()
        Write-Host ("HTTP {0} {1}`n{2}" -f $code, $Uri, $text) -ForegroundColor Yellow
        throw ("CF {0} {1}: {2}" -f $code, $Method, $text)
    }
}

function Show-DashboardHint {
    # 先给一行可直接粘的原始表达式（上面那份 JSON 里的带 \" 转义，手抄容易出错）
    Write-Host "`n表达式（直接粘进「编辑表达式」）：" -ForegroundColor White
    Write-Host $RULE.expression -ForegroundColor White
    Write-Host "`ndashboard 手建对应项：缓存 → Cache Rules → 创建规则；" -ForegroundColor Cyan
    Write-Host "  规则名称填 $DESC（脚本靠这个名字认出并只动这一条）；" -ForegroundColor Cyan
    Write-Host "  缓存资格 = 符合缓存条件；" -ForegroundColor Cyan
    Write-Host "  边缘 TTL = 「使用缓存控制标头（如果存在），否则绕过缓存」；" -ForegroundColor Cyan
    Write-Host "  浏览器 TTL = 「接受源服务器 TTL」；其余全默认（缓存密钥/Vary 都不要添加设置）。" -ForegroundColor Cyan
}

if ($Verify) {
    # 只读自检：不需要任何 API 权限。看 cf-cache-status 就知道规则生效没。
    $urls = @("https://onestarry.com", "https://onestarry.com/products", "https://onestarry.com/products/ceramic-mug")
    foreach ($u in $urls) {
        for ($i = 1; $i -le 2; $i++) {
            $t = Measure-Command { $script:hdr = curl.exe -s -o NUL -D - $u }
            $pick = { param($p) ($script:hdr | Select-String -Pattern $p | ForEach-Object { $_.Line.Trim() }) -join "" }
            Write-Host ("[{0}] try{1} ttfb={2:N2}s {3} || {4} || {5}" -f (Get-Date -Format "HH:mm:ss"), $i, $t.TotalSeconds, $u, (& $pick "^cf-cache-status:"), (& $pick "^cache-control:"))
            Start-Sleep -Seconds 2
        }
    }
    # 探针 UA 必须穿透到源站：这发应该没有 cf-cache-status（或 DYNAMIC/BYPASS），且 x-nextjs-cache 有值
    $t = Measure-Command { $script:hdr = curl.exe -s -o NUL -D - -A "onestarry-isr-probe" "https://onestarry.com/products" }
    $pick = { param($p) ($script:hdr | Select-String -Pattern $p | ForEach-Object { $_.Line.Trim() }) -join "" }
    Write-Host ("[probe] ttfb={0:N2}s {1} || {2} || {3}" -f $t.TotalSeconds, (& $pick "^cf-cache-status:"), (& $pick "^x-nextjs-cache:"), (& $pick "^cache-control:"))
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Host "需要 API token：-Token <值> 或先设 `$env:CF_API_TOKEN。" -ForegroundColor Red
    Write-Host "创建 token 时勾选：Zone > Cache Rules > Edit、Account Rulesets > Edit、Account Filter Lists > Edit。"
    Write-Host "（wrangler 登录用的 OAuth token 只有 zone:read，写不进去 —— 已实测 403）"
    Write-Host "`n规则内容如下（可直接照抄到 dashboard）：" -ForegroundColor Cyan
    $RULE | ConvertTo-Json -Depth 10
    Show-DashboardHint
    exit 1
}

# ── 读现状：拿到 phase 入口规则集（没有就是 null） ──────────────────────────────
$entry = $null
$entryExists = $false
try {
    $entry = Invoke-Cf Get "$BASE/zones/$ZoneId/rulesets/phases/$PHASE/entrypoint" $null
    $entryExists = ($null -ne $entry -and $entry.success -and $null -ne $entry.result)
} catch {
    # 该 zone 从没建过 cache rule 时这里是 404/1009，属正常状态（当作空规则集继续）。
    if ($_.Exception.Message -match "CF 404") {
        Write-Host "该 zone 还没有 cache ruleset（phase 入口不存），第一次写会新建。" -ForegroundColor Yellow
    } elseif ($_.Exception.Message -match "CF 403") {
        # 实测：wrangler 的 OAuth token 到这里就是 403，而且脚本**已经停住**，不会发生任何写入
        Write-Host "403：这个 token 没有写 cache 规则的权限，脚本已停住（未做任何写入）。" -ForegroundColor Red
        Write-Host "需要的权限：Zone > Cache Rules > Edit、Account Rulesets > Edit、Account Filter Lists > Edit。" -ForegroundColor Red
        exit 1
    } else { throw }
}

$existingRules = @()
if ($entryExists) {
    $existingRules = @($entry.result.rules)
}
$mine = $existingRules | Where-Object { $_.description -eq $DESC }

Write-Host ("现状：phase {0} 已有 {1} 条规则，其中本脚本那条 {2}" -f $PHASE, $existingRules.Count, $(if ($mine) { "在" } else { "不在" }))

if ($Rollback) {
    if (-not $mine) { Write-Host "没有本脚本加的规则，无需回滚。" -ForegroundColor Yellow; exit 0 }
    $keep = @($existingRules | Where-Object { $_.description -ne $DESC })
    Invoke-Cf Put "$BASE/zones/$ZoneId/rulesets/phases/$PHASE/entrypoint" (@{ rules = $keep } | ConvertTo-Json -Depth 12 -Compress) | Out-Null
    Write-Host ("已删掉 $DESC（其余 " + $keep.Count + " 条原样保留）。用 -Verify 复核：cf-cache-status 应消失。") -ForegroundColor Green
    exit 0
}

if (-not $Apply) {
    Write-Host "`n这是计划，未写入（加 -Apply 才动手）：" -ForegroundColor Cyan
    $RULE | ConvertTo-Json -Depth 10
    Show-DashboardHint
    exit 0
}

# ── 写：只动自己那一条，别人的规则原样带回（PUT 是整体替换，所以必须先读后合） ─────
$others = @($existingRules | Where-Object { $_.description -ne $DESC })
$mineId = $null
if ($mine) { $mineId = $mine.id }
$newRule = [ordered]@{
    expression        = $RULE.expression
    description       = $DESC
    action            = "set_cache_settings"
    action_parameters = $RULE.action_parameters
    enabled           = $true
}
if ($mineId) { $newRule.id = $mineId }   # 带 id = 原地改，不产生重复规则
$merged = @($others) + @($newRule)

# phase 入口已存在就用 PUT 整体替换（内容里带着别人的原规则，等于只动自己那条）；
# 从没建过 cache ruleset 才 POST 新建 —— 反过来做都会报错。
if ($entryExists) {
    Invoke-Cf Put "$BASE/zones/$ZoneId/rulesets/phases/$PHASE/entrypoint" (@{ rules = $merged } | ConvertTo-Json -Depth 12 -Compress) | Out-Null
} else {
    Invoke-Cf Post "$BASE/zones/$ZoneId/rulesets" (@{ kind = "zone"; phase = $PHASE; rules = $merged } | ConvertTo-Json -Depth 12 -Compress) | Out-Null
}

Write-Host ("已写入 $DESC（规则总数 " + $merged.Count + "，其中原有 " + $others.Count + " 条未动）。") -ForegroundColor Green
Write-Host "下一步：powershell -NoProfile -File scripts/cf-edge-cache.ps1 -Verify"
Write-Host "回滚：powershell -NoProfile -File scripts/cf-edge-cache.ps1 -Token <值> -Rollback"
