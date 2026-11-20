// 開場動畫：黑底白粒子撞進中心、收成 ib 標誌（assets/launch.mp4，4.4 秒、無聲）。
// 每次打開 App 都播一次（使用者 2026-11-20 選的），點一下可以跳過；
// iPhone 開了「減少動態效果」就不播。播完淡出，露出下面已經載好的畫面。
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet } from "react-native";

export function Launch({ onDone }: { onDone: () => void }) {
  const fade = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);
  const finished = useRef(false);
  const player = useVideoPlayer(require("../../assets/launch.mp4"), (p) => {
    p.muted = true;
    p.loop = false;
    p.audioMixingMode = "mixWithOthers"; // 不要打斷使用者正在聽的音樂
    p.play();
  });

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(fade, { toValue: 0, duration: 280, useNativeDriver: true }).start(() => {
      setGone(true);
      onDone();
    });
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEventListener(player, "playToEnd", () => finishRef.current());
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((on) => on && finishRef.current()).catch(() => null);
    // 影片萬一沒播起來，最多等 6 秒就放行
    const t = setTimeout(() => finishRef.current(), 6000);
    return () => clearTimeout(t);
  }, []);

  if (gone) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000000", opacity: fade, zIndex: 1000 }]}>
      <Pressable onPress={finish} accessibilityRole="button" accessibilityLabel="ideabox 開場動畫，點一下跳過" style={{ flex: 1, justifyContent: "center" }}>
        <VideoView player={player} nativeControls={false} contentFit="contain" allowsPictureInPicture={false} style={{ width: "100%", aspectRatio: 1 }} pointerEvents="none" />
      </Pressable>
    </Animated.View>
  );
}
