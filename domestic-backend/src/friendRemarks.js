// A remark belongs to its author and one friendship, never to a profile.
export function parseFriendRemark(body, required = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('请求格式不正确');
    error.statusCode = 400;
    throw error;
  }
  if (!Object.hasOwn(body, 'remark') && !required) return undefined;
  if (typeof body.remark !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(body.remark)) {
    const error = new Error('备注名称须为单行文字');
    error.statusCode = 400;
    throw error;
  }
  const remark = body.remark.trim();
  if ([...remark].length > 20) {
    const error = new Error('备注名称最多 20 个字');
    error.statusCode = 400;
    throw error;
  }
  return remark;
}

export async function saveFriendRemark(db, friendshipId, ownerId, remark) {
  // Old clients omit the field; they must not erase existing remarks.
  if (remark === undefined) return;
  if (!remark) {
    await db.query('delete from friend_remarks where friendship_id = $1 and owner_id = $2', [friendshipId, ownerId]);
    return;
  }
  await db.query(
    `insert into friend_remarks (friendship_id, owner_id, remark) values ($1, $2, $3)
     on conflict (friendship_id, owner_id) do update set remark = excluded.remark, updated_at = now()`,
    [friendshipId, ownerId, remark],
  );
}
