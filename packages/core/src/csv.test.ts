import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, csvToObjects } from "./csv";

test("parseCsv 处理引号内逗号与转义双引号", () => {
    const rows = parseCsv('a,b\n"x,y","he said ""hi"""\n');
    assert.deepEqual(rows[0], ["a", "b"]);
    assert.deepEqual(rows[1], ["x,y", 'he said "hi"']);
});

test("csvToObjects 按表头映射为对象", () => {
    const objs = csvToObjects('sku,title\nMUG,"Big Mug"\n');
    assert.equal(objs.length, 1);
    assert.equal(objs[0]?.sku, "MUG");
    assert.equal(objs[0]?.title, "Big Mug");
});

test("csvToObjects 缺列补空串、忽略空行", () => {
    const objs = csvToObjects("sku,price\nA,1\n\nB,2\n");
    assert.equal(objs.length, 2);
    assert.equal(objs[1]?.sku, "B");
});
