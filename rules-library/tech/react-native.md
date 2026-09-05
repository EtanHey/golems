# React Native / Expo Context

> Use this context for React Native and Expo projects.

---

## Tech Stack
- **Framework:** Expo, React Native
- **Styling:** NativeWind v4 (Tailwind CSS for React Native)
- **State:** Zustand (client state), TanStack Query (server state)
- **Icons:** `lucide-react-native` (NEVER use @expo/vector-icons)
- **Navigation:** Expo Router (file-based)

---

## Styling: Use NativeWind - NOT StyleSheet

**CRITICAL: Always use NativeWind (Tailwind) classes, NEVER use StyleSheet.create()**

```tsx
// CORRECT - Use NativeWind className
<View className="flex-1 px-4 items-center gap-2">
  <Text className="text-2xl font-bold text-white">Hello</Text>
</View>

// WRONG - Never use StyleSheet
const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 }
});
```

### Responsive Sizing with NativeWind
```tsx
// Responsive height (percentage)
<View className="h-[35%]" />

// Responsive font sizes (sm: breakpoint)
<Text className="text-2xl sm:text-3xl" />

// Responsive spacing
<View className="gap-2 md:gap-4" />
```

### Common NativeWind Patterns
- **Flex layout:** `flex-1`, `flex-row`, `items-center`, `justify-center`
- **Spacing:** `gap-2`, `px-4`, `py-2`, `mt-6`, `mb-4`
- **Colors:** `bg-white`, `text-gray-700`, `border-blue-500`
- **Sizing:** `w-full`, `h-[200px]`, `w-[50%]`
- **Text:** `text-sm`, `text-xl`, `font-bold`, `text-center`

---

## Quick Start

```bash
cd apps/expo
npx expo start --dev-client --ios
```

---

## iOS Simulator

**Use iOS 17.5 or iOS 26.0. Avoid iOS 26.1 (compatibility issues).**

```bash
# List available simulators
xcrun simctl list devices

# Boot a specific simulator
xcrun simctl boot DEVICE_UUID
```

---

## Rebuild vs Reload

**JS-only changes:** Just reload (Cmd+R in simulator)
- Component logic, styling, screens, state, API calls

**Native changes:** Requires rebuild
- Adding/removing pods, native code, Info.plist, RN version

---

## Error Escalation (follow this order)

1. `Cmd+Shift+K` - Clean build (5 sec)
2. `bun ios:derived` - Clear Xcode cache (5 sec)
3. `npx expo start --clear` - Clear Metro (10 sec)
4. `bun ios:pods` - Reinstall pods (30-60 sec)
5. `bun ios:reset` - Nuclear option (1-5 min)

---

## Common Fixes

### iOS 26 ExpoLocalization Swift Error
Add `@unknown default: return "gregory"` to switch in:
`node_modules/expo-localization/ios/LocalizationModule.swift`

Must reapply after `bun install` or use patch-package.

### Metro Bundler Issues
```bash
npx expo start --clear
```

### Pod Issues
```bash
cd ios && pod install --repo-update && cd ..
```

---

## Navigation (Expo Router)

```
app/
├── _layout.tsx        # Root layout
├── index.tsx          # Home screen
├── (tabs)/            # Tab navigator group
│   ├── _layout.tsx    # Tab layout
│   ├── home.tsx       # Home tab
│   └── profile.tsx    # Profile tab
└── [id].tsx           # Dynamic route
```

### Layout Example
```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Home' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
```

### Navigation
```tsx
import { Link, useRouter } from 'expo-router';

// Link component
<Link href="/profile">Go to Profile</Link>
<Link href={{ pathname: '/item/[id]', params: { id: '123' } }}>Item 123</Link>

// Programmatic navigation
const router = useRouter();
router.push('/profile');
router.replace('/home');
router.back();
```

---

## Zustand State Management

```tsx
// store/useAppStore.ts
import { create } from 'zustand';

interface AppState {
  count: number;
  increment: () => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  reset: () => set({ count: 0 }),
}));

// Usage in component
const { count, increment } = useAppStore();
```

---

## Safe Area

```tsx
import { SafeAreaView } from 'react-native-safe-area-context';

export default function Screen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-4">
        {/* Content */}
      </View>
    </SafeAreaView>
  );
}
```

---

## Keyboard Handling

```tsx
import { KeyboardAvoidingView, Platform } from 'react-native';

<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  className="flex-1"
>
  {/* Form content */}
</KeyboardAvoidingView>
```

---

## Image Handling

```tsx
import { Image } from 'expo-image';

<Image
  source={{ uri: imageUrl }}
  className="w-full h-48 rounded-lg"
  contentFit="cover"
  transition={200}
/>
```

---

## Haptics

```tsx
import * as Haptics from 'expo-haptics';

// Light feedback
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

// Success feedback
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
```

---

## TestFlight Deployment

```bash
# Open Xcode workspace
open ios/AppName.xcworkspace

# Select "Any iOS Device (arm64)" → Product → Archive → Distribute
```

- Ensure bundle ID matches App Store Connect
- Update version/build numbers before each submission
- Privacy policy URL required for submission

---

## Key Directories

```
app/                    # Expo Router screens
components/             # Reusable components
components/ui/          # Design system primitives
store/                  # Zustand stores
services/               # API services, QueryClient
hooks/                  # Custom React hooks
```
