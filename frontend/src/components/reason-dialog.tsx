"use client";

import {FormEvent, useState} from "react";
import {X} from "lucide-react";

const MIN_LENGTH = 3;

export function ReasonDialog({title, description, confirmLabel, onConfirm, onCancel}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const valid = reason.trim().length >= MIN_LENGTH;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    onConfirm(reason.trim());
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <form
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="dialog-head">
          <h3 id="reason-dialog-title">{title}</h3>
          <button type="button" aria-label="ปิดหน้าต่างนี้" onClick={onCancel}><X size={18}/></button>
        </div>
        <p>{description}</p>
        <label htmlFor="reason-dialog-input">เหตุผล (อย่างน้อย {MIN_LENGTH} ตัวอักษร)</label>
        <input
          id="reason-dialog-input"
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !valid}
          aria-describedby={touched && !valid ? "reason-dialog-error" : undefined}
          placeholder="เช่น เจ้าของสนามแจ้งให้เริ่มก่อนเวลา"
        />
        {touched && !valid && <span id="reason-dialog-error" className="dialog-error">ต้องระบุเหตุผลอย่างน้อย {MIN_LENGTH} ตัวอักษร</span>}
        <div className="dialog-actions">
          <button type="button" className="dialog-secondary" onClick={onCancel}>ยกเลิก</button>
          <button type="submit" className="dialog-primary" disabled={!valid}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
