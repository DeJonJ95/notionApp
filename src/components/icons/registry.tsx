// Curated lucide icon set used for workspace/page icons and the icon picker.
// Icons are stored by NAME (e.g. "rocket"); EntityIcon renders the matching
// lucide component. Existing emoji icons still render verbatim for backward
// compatibility, and the bare legacy defaults normalize to a clean lucide icon.

import {
  Home, Briefcase, Rocket, Wallet, BarChart3, Target, BookOpen, Code, Palette,
  Heart, Star, Calendar, Folder, FileText, Lightbulb, Music, Camera, Globe,
  Flag, Bookmark, Coffee, Plane, Car, Gift, Bell, Flame, Leaf, Sun, Moon,
  Cloud, Zap, Shield, Users, Mail, Building2, Store, GraduationCap, Dumbbell,
  Utensils, Gamepad2, PenTool, Compass, Map, Aperture, MessageSquare, type LucideIcon,
} from 'lucide-react';

export const ICON_REGISTRY: Record<string, LucideIcon> = {
  home: Home, briefcase: Briefcase, rocket: Rocket, wallet: Wallet,
  chart: BarChart3, target: Target, book: BookOpen, code: Code, design: Palette,
  heart: Heart, star: Star, calendar: Calendar, folder: Folder, file: FileText,
  idea: Lightbulb, music: Music, camera: Camera, globe: Globe, flag: Flag,
  bookmark: Bookmark, coffee: Coffee, plane: Plane, car: Car, gift: Gift,
  bell: Bell, flame: Flame, leaf: Leaf, sun: Sun, moon: Moon, cloud: Cloud,
  zap: Zap, shield: Shield, users: Users, mail: Mail, building: Building2,
  store: Store, education: GraduationCap, fitness: Dumbbell, food: Utensils,
  game: Gamepad2, pen: PenTool, compass: Compass, map: Map, aperture: Aperture,
  chat: MessageSquare,
};

export const ICON_NAMES = Object.keys(ICON_REGISTRY);

// Bare legacy placeholders that should fall through to a clean default icon
// rather than rendering as a tacky emoji.
const LEGACY_DEFAULTS = new Set(['📄', '📁', '📝', '']);

export function EntityIcon({
  icon,
  kind = 'page',
  size = 16,
  className,
}: {
  icon?: string | null;
  kind?: 'page' | 'workspace';
  size?: number;
  className?: string;
}) {
  const val = (icon ?? '').trim();
  if (val && !LEGACY_DEFAULTS.has(val)) {
    const Cmp = ICON_REGISTRY[val];
    if (Cmp) return <Cmp size={size} className={className} />;
    // A user-chosen emoji or arbitrary glyph — render it as text.
    return (
      <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
        {val}
      </span>
    );
  }
  const Fallback = kind === 'workspace' ? Folder : FileText;
  return <Fallback size={size} className={className ?? 'text-muted'} />;
}
