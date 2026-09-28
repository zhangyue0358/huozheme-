import fs from 'node:fs/promises';

export async function inspectDatabaseSchema(db) {
  const sql = await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const expected = [...sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)]
    .flatMap(([, table, body]) => body.split('\n').map(line => {
      const match = line.match(/^  (\w+)\s+(uuid|text\[\]|text|bigint|integer|smallint|boolean|date|timestamptz)(?=\s)/);
      return match ? { table, column: match[1], type: match[2] } : null;
    }).filter(Boolean));
  if (expected.length < 50) throw new Error('数据库结构检查无法解析 schema.sql');
  const { rows } = await db.query(
    `select table_name, column_name, udt_name
     from information_schema.columns where table_schema = current_schema()`,
  );
  const actual = new Map(rows.map(row => [`${row.table_name}.${row.column_name}`, row.udt_name]));
  const types = { integer: 'int4', smallint: 'int2', bigint: 'int8', boolean: 'bool', 'text[]': '_text' };
  const missing = [];
  const incompatible = [];
  for (const item of expected) {
    const key = `${item.table}.${item.column}`;
    if (!actual.has(key)) missing.push(key);
    else if (actual.get(key) !== (types[item.type] || item.type)) incompatible.push(key);
  }
  return { ok: missing.length === 0 && incompatible.length === 0, missing, incompatible };
}

export async function assertDatabaseSchema(db) {
  const result = await inspectDatabaseSchema(db);
  if (!result.ok) {
    throw new Error(`数据库升级未完成；缺少字段: ${result.missing.join(', ') || '无'}；类型不匹配: ${result.incompatible.join(', ') || '无'}。请先由表所有者执行对应 db/patch_*.sql，再部署后端。`);
  }
  return result;
}
