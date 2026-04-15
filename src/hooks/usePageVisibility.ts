import { useEffect, useState } from "react";

function readVisibility(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  return !document.hidden;
}

export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(readVisibility);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleVisibilityChange = () => {
      setIsVisible(readVisibility());
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
