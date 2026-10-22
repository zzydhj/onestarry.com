param(
    # 用 -File 调用时数组参数无法用逗号传入，故收单个逗号分隔串再拆
    [string]$Urls = "https://onestarry.com,https://onestarry.com/products,https://onestarry.com/products/ceramic-mug",
    [int]$Rounds = 10,
    [int]$GapSeconds = 20,
    [string]$OutFile = "isr-watch.txt"
)

$urlList = $Urls -split ',' | Where-Object { $_.Trim() }
Set-Content -Path $OutFile -Value ("probe start {0}" -f (Get-Date -Format "HH:mm:ss"))
for ($r = 1; $r -le $Rounds; $r++) {
    foreach ($u in $urlList) {
        $t = Measure-Command { $script:hdrs = curl.exe -s -o NUL -D - $u }
        $pick = { param($p) ($script:hdrs | Select-String -Pattern $p | ForEach-Object { $_.Line.Trim() }) -join "" }
        $line = "[{0}] r{1} ttfb={2:N2}s {3} || {4} || {5} || {6}" -f (Get-Date -Format "HH:mm:ss"), $r, $t.TotalSeconds, $u, (& $pick "^x-nextjs-cache:"), (& $pick "^x-nextjs-stale-time:"), (& $pick "^cache-control:")
        Add-Content -Path $OutFile -Value $line
    }
    Start-Sleep -Seconds $GapSeconds
}
Get-Content $OutFile
