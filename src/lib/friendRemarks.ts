export const FRIEND_REMARK_LIMIT = 20;

export function friendDisplayName(friend: { name: string; remark?: string }) {
  const remark = friend.remark?.trim();
  return remark ? `${remark}（${friend.name}）` : friend.name;
}

export function friendRemarkError(value: string) {
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) return '备注名称须为单行文字';
  if ([...value.trim()].length > FRIEND_REMARK_LIMIT) return '备注名称最多 20 个字';
  return '';
}
