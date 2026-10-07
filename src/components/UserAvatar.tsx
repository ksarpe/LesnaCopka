import type { StyleProp, ViewStyle } from 'react-native';

import { useUserStore } from '@/store/useUserStore';
import { Avatar } from './Avatar';

interface UserAvatarProps {
  size: number;
  ringColor?: string;
  ringWidth?: number;
  stripe?: number;
  style?: StyleProp<ViewStyle>;
}

/** Avatar zalogowanego gracza (zdjęcie / motyw z ustawień profilu) – profil, Start, własne wpisy w feedzie. */
export function UserAvatar(props: UserAvatarProps) {
  const avatar = useUserStore((s) => s.user.avatar);
  return <Avatar {...props} avatar={avatar} />;
}
