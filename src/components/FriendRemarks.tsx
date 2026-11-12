import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { FRIEND_REMARK_LIMIT, friendDisplayName, friendRemarkError } from '../lib/friendRemarks';
import type { Friend } from '../lib/types';

export type FriendRemarkTarget = {
  mode: 'menu' | 'send' | 'accept' | 'edit';
  id: string;
  name: string;
  phone: string;
  remark?: string;
};

export function FriendName({ name, remark, style }: { name: string; remark?: string; style?: StyleProp<TextStyle> }) {
  const ownName = remark?.trim();
  return (
    <Text style={style} numberOfLines={2} accessibilityLabel={friendDisplayName({ name, remark })}>
      {ownName || name}
      {ownName ? <Text style={s.originalName}>（{name}）</Text> : null}
    </Text>
  );
}

export function FriendOptionsMenu({ friend, onEdit, onClose }: {
  friend: Pick<Friend, 'name' | 'remark'>;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭好友操作" onPress={onClose} />
        <View style={s.card} accessibilityViewIsModal>
          <FriendName name={friend.name} remark={friend.remark} style={s.title} />
          <Pressable style={s.menuAction} accessibilityRole="button" onPress={onEdit}>
            <Text style={s.primaryText}>修改备注</Text>
          </Pressable>
          <Pressable style={s.secondary} accessibilityRole="button" onPress={onClose}>
            <Text style={s.secondaryText}>取消</Text>
          </Pressable>
        </View>
      </View>
  );
}

export function FriendRemarkDialog({ target, onSubmit, onClose, onEdit }: {
  target: FriendRemarkTarget;
  onSubmit: (remark: string) => Promise<boolean>;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState(target.remark || '');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const error = friendRemarkError(draft);
  const title = target.mode === 'edit' ? '修改备注' : target.mode === 'accept' ? '确认接受好友' : '确认添加好友';
  const action = target.mode === 'edit' ? '保存备注' : target.mode === 'accept' ? '确认接受' : '发送好友申请';

  function close() {
    if (!busy.current) onClose();
  }

  async function submit() {
    if (busy.current || error) return;
    busy.current = true;
    setSaving(true);
    try {
      const saved = await onSubmit(draft.trim());
      if (mounted.current && saved) onClose();
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={close}>
      {target.mode === 'menu' ? <FriendOptionsMenu friend={target} onEdit={onEdit} onClose={close} /> : (
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭备注设置" disabled={saving} onPress={close} />
        <View style={s.card} accessibilityViewIsModal>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
            <Text style={s.title}>{title}</Text>
            <Text style={s.hint}>{target.name ? `${target.name} · ${target.phone}` : `手机号：${target.phone}`}</Text>
            <Text style={s.label}>备注名称 <Text style={s.optional}>（选填）</Text></Text>
            <TextInput
              accessibilityLabel="备注名称，选填"
              autoFocus autoCorrect={false} autoCapitalize="none"
              maxLength={FRIEND_REMARK_LIMIT * 2}
              editable={!saving} placeholder="例如：妈妈、大学室友"
              placeholderTextColor="#8e9188" returnKeyType="done"
              onSubmitEditing={submit} onChangeText={setDraft} style={s.input} value={draft}
            />
            <View style={s.hintRow}>
              <Text style={s.hint}>仅自己可见，不修改对方昵称</Text>
              <Text style={[s.hint, !!error && s.error]}>{[...draft.trim()].length}/{FRIEND_REMARK_LIMIT}</Text>
            </View>
            {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
            <View style={s.preview}>
              <Text style={s.hint}>{target.name ? '显示效果' : '你的备注'}</Text>
              {target.name ? <FriendName name={target.name} remark={draft} style={s.previewName} /> :
                <Text style={s.previewName}>{draft.trim() || '未设置备注'}</Text>}
              <Text style={s.hint}>留空时显示对方昵称，之后可在好友菜单中修改。</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving || !!error, busy: saving }}
              disabled={saving || !!error} style={[s.primary, (saving || !!error) && s.disabled]} onPress={submit}>
              {saving ? <ActivityIndicator color="#142015" /> : <Text style={s.primaryText}>{action}</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" disabled={saving} style={s.secondary} onPress={close}>
              <Text style={s.secondaryText}>取消</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 440, maxHeight: '90%', padding: 20, backgroundColor: '#20221e', borderWidth: 1, borderColor: '#383e32', borderRadius: 24 },
  content: { gap: 14 },
  title: { color: '#f6f5ed', fontSize: 21, fontWeight: '800' },
  originalName: { color: '#aaa99e', fontSize: 13, fontWeight: '400' },
  hint: { color: '#aaa99e', fontSize: 12, lineHeight: 19 },
  hintRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  label: { color: '#f6f5ed', fontSize: 15, fontWeight: '700', marginTop: 6 },
  optional: { color: '#aaa99e', fontWeight: '400', fontSize: 13 },
  input: { minHeight: 50, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#2a2e25', borderWidth: 1, borderColor: '#586d43', color: '#f6f5ed', fontSize: 16, textAlignVertical: 'center', includeFontPadding: false },
  preview: { padding: 14, borderRadius: 14, backgroundColor: '#282f22', gap: 8 },
  previewName: { color: '#f6f5ed', fontSize: 16, fontWeight: '800' },
  primary: { backgroundColor: '#a2e278', minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, padding: 12 },
  primaryText: { color: '#142015', fontSize: 16, fontWeight: '800' },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 10 },
  secondaryText: { color: '#aaa99e', fontSize: 15 },
  menuAction: { marginTop: 20, minHeight: 48, borderRadius: 14, padding: 12, alignItems: 'center', backgroundColor: '#a2e278' },
  disabled: { opacity: 0.5 },
  error: { color: '#ffaaa0', fontSize: 12 },
});
