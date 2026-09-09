"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SkinToggle from "@/components/kargah/SkinToggle";
import FontPicker from "@/components/FontPicker";
import Avatar from "@/components/kargah/Avatar";
import { useToast } from "@/components/ToastProvider";

/** The one control at the end of the top bar: the viewer's avatar, opening a dropdown
 *  that holds everything that used to sit loose beside it -- the map link and the
 *  appearance controls (skin / font). Same click-outside + Esc dismissal as
 *  AccentPicker.
 *
 *  No accent picker here (2026-09-08 substrate redesign, Task 11): kargah is now a
 *  fixed cool+black palette, not re-tintable per user. AccentPicker still exists for the
 *  map, which keeps its own accent-theme choice -- see components/AccentPicker.tsx.
 */
export default function ProfileMenu({
  userId,
  name,
  roleLabel,
}: {
  userId: number;
  name: string;
  roleLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Bumps both <Avatar> instances' `key` after a change, so a fresh upload/removal
  // actually replaces a cached broken/old image instead of an Avatar that already
  // resolved imgFailed=true (or an old picture) before the change happened. Shared
  // across the trigger button's small avatar AND the open panel's larger one -- both
  // need to refresh together, not just whichever one happened to be visible.
  const [avatarNonce, setAvatarNonce] = useState(0);

  async function handleAvatarFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/users/${userId}/avatar`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "خطا در آپلود تصویر");
      }
      toast("تصویر پروفایل به‌روزرسانی شد.", "success");
      setAvatarNonce((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در آپلود تصویر", "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeAvatar() {
    try {
      const res = await fetch(`/api/users/${userId}/avatar`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast("تصویر پروفایل حذف شد.", "info");
      setAvatarNonce((n) => n + 1);
    } catch {
      toast("خطا در حذف تصویر", "error");
    }
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="pm">
      <button
        type="button"
        className="pm__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${name} — ${roleLabel}`}
        title={`${name} · ${roleLabel}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar key={avatarNonce} userId={userId} name={name} size={34} />
      </button>

      {open && (
        <div dir="rtl" role="dialog" aria-label="حساب و ظاهر" className="pm__panel">
          <div className="pm__who">
            <label className="pm__avatarLabel" title="تغییر تصویر پروفایل">
              <Avatar key={avatarNonce} userId={userId} name={name} size={38} />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatarFile(f);
                }}
              />
            </label>
            <div>
              <div className="pm__name">{name}</div>
              <div className="pm__role">{roleLabel}</div>
            </div>
          </div>
          <button
            type="button"
            className="pm__link"
            style={{ textAlign: "start", width: "100%", border: 0, background: "transparent", cursor: "pointer" }}
            disabled={uploading}
            onClick={removeAvatar}
          >
            حذف تصویر پروفایل
          </button>

          <div className="pm__sep" />

          <Link className="pm__link" href="/map" onClick={() => setOpen(false)}>
            ↗ نقشهٔ پوشش
          </Link>

          <Link className="pm__link" href="/settings/notifications" onClick={() => setOpen(false)}>
            ↗ تنظیمات اعلان‌ها
          </Link>

          <div className="pm__sep" />

          <div className="pm__row">
            <span>پوسته</span>
            <SkinToggle />
          </div>
          <div className="pm__row">
            <span>قلم</span>
            <FontPicker />
          </div>
        </div>
      )}
    </div>
  );
}
