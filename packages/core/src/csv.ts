/**
 * 极简 RFC4180 风格 CSV 解析：支持带引号字段、字段内逗号、转义双引号("")、CRLF。
 * 返回 string[][]（含表头行）。不做类型转换（交给调用方）。
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let field = "";
    let row: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
            continue;
        }
        if (c === '"') inQuotes = true;
        else if (c === ",") {
            row.push(field);
            field = "";
        } else if (c === "\n") {
            row.push(field);
            if (!(row.length === 1 && row[0] === "")) rows.push(row); // 跳过空行
            row = [];
            field = "";
        } else if (c !== "\r") {
            field += c;
        }
    }
    if (field !== "" || row.length > 0) {
        row.push(field);
        if (!(row.length === 1 && row[0] === "")) rows.push(row); // 跳过末尾空行
    }
    return rows;
}

/** 表头 → 每行对象（键小写去空格）。 */
export function csvToObjects(text: string): Record<string, string>[] {
    const rows = parseCsv(text);
    if (rows.length === 0) return [];
    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    return rows.slice(1).map((r) => {
        const obj: Record<string, string> = {};
        header.forEach((h, i) => (obj[h] = (r[i] ?? "").trim()));
        return obj;
    });
}
