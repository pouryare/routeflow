"use client";

import { InputOTP } from "@heroui/react";
import { normaliseCode } from "@/lib/otpCode";

const LENGTH = 6;

/** Six boxes for an authenticator code. Digits are always left to right, the phone's one-time-code
 *  autofill works, Persian digits are accepted, and the sixth digit submits by itself. */
export default function OtpInput({
  value,
  onChange,
  onComplete,
  isInvalid,
  disabled,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  isInvalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div dir="ltr" className="flex justify-center">
      <InputOTP
        maxLength={LENGTH}
        value={value}
        isDisabled={disabled}
        isInvalid={isInvalid}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="کد ۶ رقمی"
        pasteTransformer={(pasted) => normaliseCode(pasted).replace(/\D/g, "").slice(0, LENGTH)}
        onChange={(v) => onChange(normaliseCode(v).replace(/\D/g, "").slice(0, LENGTH))}
        onComplete={(v) => onComplete?.(normaliseCode(v).slice(0, LENGTH))}
      >
        <InputOTP.Group>
          {[0, 1, 2].map((i) => <InputOTP.Slot key={i} index={i} />)}
        </InputOTP.Group>
        <InputOTP.Separator />
        <InputOTP.Group>
          {[3, 4, 5].map((i) => <InputOTP.Slot key={i} index={i} />)}
        </InputOTP.Group>
      </InputOTP>
    </div>
  );
}
