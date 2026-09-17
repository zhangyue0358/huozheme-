import * as FileSystem from 'expo-file-system/legacy';
import type { AppSnapshot, PersonalMessage, Todo } from './types';
import { domesticRequest } from './domesticClient';

const MAX_JOURNAL_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export type DomesticJournalPhotoAsset = {
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string | null;
  uri: string;
};

function inferPhotoContentType(uri: string) {
  const cleanUri = uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.png')) return { contentType: 'image/png', fileName: 'journal.png' };
  if (cleanUri.endsWith('.webp')) return { contentType: 'image/webp', fileName: 'journal.webp' };
  if (cleanUri.endsWith('.heic')) return { contentType: 'image/heic', fileName: 'journal.heic' };
  return { contentType: 'image/jpeg', fileName: 'journal.jpg' };
}

export async function loadDomesticAppSnapshot(): Promise<AppSnapshot> {
  const snapshot = await domesticRequest<AppSnapshot>('/me/snapshot');
  const aliveDays = typeof snapshot.aliveDays === 'number' && Number.isFinite(snapshot.aliveDays)
    ? Math.max(0, Math.floor(snapshot.aliveDays))
    : 0;
  const streak = typeof snapshot.streak === 'number' && Number.isFinite(snapshot.streak)
    ? Math.max(0, Math.floor(snapshot.streak))
    : 0;
  return {
    ...snapshot,
    aliveDays,
    aliveReplies: Array.isArray(snapshot.aliveReplies) ? snapshot.aliveReplies : [],
    diaryEntries: Array.isArray(snapshot.diaryEntries) ? snapshot.diaryEntries : [],
    friendRequests: Array.isArray(snapshot.friendRequests)
      ? snapshot.friendRequests.map((request) => ({
          ...request,
          avatarUrl: typeof request.avatarUrl === 'string' ? request.avatarUrl : '',
        }))
      : [],
    friends: Array.isArray(snapshot.friends)
      ? snapshot.friends.map((friend) => ({
          ...friend,
          avatarUrl: typeof friend.avatarUrl === 'string' ? friend.avatarUrl : '',
        }))
      : [],
    incomingPokes: Array.isArray(snapshot.incomingPokes) ? snapshot.incomingPokes : [],
    journalPhotoPaths: Array.isArray(snapshot.journalPhotoPaths) ? snapshot.journalPhotoPaths : [],
    journalPhotoUrls: Array.isArray(snapshot.journalPhotoUrls) ? snapshot.journalPhotoUrls : [],
    journalText: typeof snapshot.journalText === 'string' ? snapshot.journalText : '',
    quoteSaved: snapshot.quoteSaved === true,
    personalMessages: Array.isArray(snapshot.personalMessages) ? snapshot.personalMessages : [],
    profile: {
      ...snapshot.profile,
      avatarUrl: typeof snapshot.profile?.avatarUrl === 'string' ? snapshot.profile.avatarUrl : '',
    },
    sentPokes: Array.isArray(snapshot.sentPokes) ? snapshot.sentPokes : [],
    statusText: typeof snapshot.statusText === 'string' ? snapshot.statusText : '',
    streak,
    todos: Array.isArray(snapshot.todos) ? snapshot.todos : [],
  };
}

export async function updateDomesticProfile(nickname: string) {
  await domesticRequest('/me/profile', {
    body: { nickname },
    method: 'PUT',
  });
}

export async function updateDomesticPrivacySetting(showStatusToFriends: boolean) {
  await domesticRequest('/me/privacy', {
    body: { showStatusToFriends },
    method: 'PUT',
  });
}

export async function saveDomesticCheckin(
  statusText: string,
  quoteText: string,
  journalText: string,
  journalPhotoPaths: string[],
  weatherText: string,
) {
  await domesticRequest('/checkins/today', {
    body: {
      journalPhotoPaths,
      journalText,
      quoteText,
      statusText,
      weatherText,
    },
    method: 'POST',
  });
}

export async function saveDomesticQuote(quoteText: string) {
  await domesticRequest('/checkins/today/quote', {
    body: { quoteText },
    method: 'POST',
  });
}

export async function confirmDomesticCheckin(statusText: string, weatherText: string) {
  await domesticRequest('/checkins/today/confirm', {
    body: { statusText, weatherText },
    method: 'POST',
  });
}

function getPhotoUploadMetadata(asset: DomesticJournalPhotoAsset) {
  const inferred = inferPhotoContentType(asset.uri);
  const contentType = asset.mimeType?.startsWith('image/') ? asset.mimeType.toLowerCase() : inferred.contentType;
  const fileName = asset.fileName?.trim() || inferred.fileName;
  return { contentType, fileName };
}

function getOssErrorCode(responseBody: string) {
  return responseBody.match(/<Code>([^<]+)<\/Code>/i)?.[1] || '';
}

export async function uploadDomesticJournalPhoto(asset: DomesticJournalPhotoAsset) {
  const { contentType, fileName } = getPhotoUploadMetadata(asset);
  const fileInfo = await FileSystem.getInfoAsync(asset.uri);
  const byteSize = asset.fileSize || (fileInfo.exists ? fileInfo.size : 0);

  if (!fileInfo.exists || byteSize <= 0) {
    throw new Error('无法读取所选照片，请重新选择后再试。');
  }
  if (byteSize > MAX_JOURNAL_PHOTO_BYTES) {
    throw new Error('照片不能超过 10 MB，请选择较小的照片。');
  }

  const policy = await domesticRequest<{
    fields: Record<string, string>;
    objectKey: string;
    uploadUrl: string;
  }>('/journal/photos/upload-policy', {
    body: { contentType, fileName },
    method: 'POST',
  });

  let uploadResponse: FileSystem.FileSystemUploadResult;
  try {
    uploadResponse = await FileSystem.uploadAsync(policy.uploadUrl, asset.uri, {
      fieldName: 'file',
      httpMethod: 'POST',
      mimeType: contentType,
      parameters: policy.fields,
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    });
  } catch {
    throw new Error('连接照片存储服务失败，请检查网络后重试。');
  }
  if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
    const ossCode = getOssErrorCode(uploadResponse.body);
    if (uploadResponse.status === 413 || ossCode === 'EntityTooLarge') {
      throw new Error('照片不能超过 10 MB，请选择较小的照片。');
    }
    throw new Error(`照片存储服务返回异常（${uploadResponse.status}${ossCode ? ` / ${ossCode}` : ''}），请稍后再试。`);
  }

  const confirmed = await domesticRequest<{ path: string; signedUrl: string }>('/journal/photos/confirm', {
    body: {
      byteSize,
      contentType,
      objectKey: policy.objectKey,
    },
    method: 'POST',
  });

  return {
    path: confirmed.path,
    signedUrl: confirmed.signedUrl,
  };
}

export async function uploadDomesticProfileAvatar(asset: DomesticJournalPhotoAsset) {
  const { contentType, fileName } = getPhotoUploadMetadata(asset);
  const fileInfo = await FileSystem.getInfoAsync(asset.uri);
  const byteSize = asset.fileSize || (fileInfo.exists ? fileInfo.size : 0);

  if (!fileInfo.exists || byteSize <= 0) {
    throw new Error('无法读取所选头像，请重新选择后再试。');
  }
  if (byteSize > MAX_AVATAR_BYTES) {
    throw new Error('头像不能超过 5 MB，请选择较小的照片。');
  }

  const policy = await domesticRequest<{
    fields: Record<string, string>;
    objectKey: string;
    uploadUrl: string;
  }>('/me/avatar/upload-policy', {
    body: { contentType, fileName },
    method: 'POST',
  });

  let uploadResponse: FileSystem.FileSystemUploadResult;
  try {
    uploadResponse = await FileSystem.uploadAsync(policy.uploadUrl, asset.uri, {
      fieldName: 'file',
      httpMethod: 'POST',
      mimeType: contentType,
      parameters: policy.fields,
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    });
  } catch {
    throw new Error('连接头像存储服务失败，请检查网络后重试。');
  }
  if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
    const ossCode = getOssErrorCode(uploadResponse.body);
    if (uploadResponse.status === 413 || ossCode === 'EntityTooLarge') {
      throw new Error('头像不能超过 5 MB，请选择较小的照片。');
    }
    throw new Error(`头像存储服务返回异常（${uploadResponse.status}${ossCode ? ` / ${ossCode}` : ''}），请稍后再试。`);
  }

  return domesticRequest<{ avatarUrl: string; path: string }>('/me/avatar/confirm', {
    body: {
      byteSize,
      contentType,
      objectKey: policy.objectKey,
    },
    method: 'POST',
  });
}

export async function deleteDomesticJournalPhoto(path: string) {
  await domesticRequest('/journal/photos', {
    body: { path },
    method: 'DELETE',
  });
}

export async function createDomesticTodo(text: string, important: boolean): Promise<Todo> {
  const result = await domesticRequest<{ todo: Todo }>('/todos', {
    body: { important, text },
    method: 'POST',
  });
  return result.todo;
}

export async function updateDomesticTodoDone(todoId: string, done: boolean) {
  await domesticRequest(`/todos/${todoId}`, {
    body: { done },
    method: 'PATCH',
  });
}

export async function updateDomesticTodoImportant(todoId: string, important: boolean) {
  await domesticRequest(`/todos/${todoId}`, {
    body: { important },
    method: 'PATCH',
  });
}

export async function saveDomesticPersonalMessages(
  messages: Pick<PersonalMessage, 'recipientName' | 'message'>[],
): Promise<PersonalMessage[]> {
  const result = await domesticRequest<{ personalMessages: PersonalMessage[] }>('/personal-messages', {
    body: { personalMessages: messages },
    method: 'PUT',
  });
  return Array.isArray(result.personalMessages) ? result.personalMessages : [];
}

export async function sendDomesticFriendRequest(phone: string) {
  await domesticRequest('/friends/request', {
    body: { phone },
    method: 'POST',
  });
}

export async function acceptDomesticFriendRequest(requestId: string) {
  await domesticRequest(`/friends/requests/${requestId}/accept`, {
    method: 'POST',
  });
}

export async function deleteDomesticFriendship(friendId: string) {
  await domesticRequest(`/friends/${friendId}`, {
    method: 'DELETE',
  });
}

export async function pokeDomesticFriend(friendId: string) {
  await domesticRequest(`/friends/${friendId}/poke`, {
    method: 'POST',
  });
}

export async function replyDomesticAliveToPoke(friendId: string) {
  await domesticRequest(`/friends/${friendId}/alive-reply`, {
    method: 'POST',
  });
}

export async function acknowledgeDomesticAliveReply(replyId: string) {
  await domesticRequest(`/alive-replies/${replyId}/acknowledge`, {
    method: 'POST',
  });
}

export async function requestDomesticAccountDeletion() {
  await domesticRequest('/account/deletion-request', {
    method: 'POST',
  });
}

export async function deleteDomesticOwnAppData() {
  await domesticRequest('/me/app-data', {
    method: 'DELETE',
  });
}
