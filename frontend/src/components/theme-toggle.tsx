"use client";

import {useEffect, useState} from "react";
import {Sun, Moon} from "lucide-react";

const STORAGE_KEY = "sailfish-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.dataset.theme = saved;
    }
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <button type="button" className="theme-toggle" aria-label={theme === "dark" ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"} onClick={toggle}>
      {theme === "dark" ? <Sun size={14}/> : <Moon size={14}/>}
      {theme === "dark" ? "โหมดสว่าง" : "โหมดมืด"}
    </button>
  );
}
