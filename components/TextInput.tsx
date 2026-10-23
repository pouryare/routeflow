"use client";

import { useState, type HTMLAttributes } from "react";
import { Button, FieldError, InputGroup, Input, Label, TextField } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";

type Common = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  placeholder?: string;
  /** Shown under the field, and marks it invalid, when set. */
  error?: string | null;
  dir?: "rtl" | "ltr";
  className?: string;
};

/** A labelled text field: HeroUI's TextField, Label and Input, with the error under it. The
 *  label is a real <label> tied to the input by React Aria; the field is 44 px tall. */
export function TextInput({
  label, value, onChange, name, autoComplete, autoFocus, required, placeholder, error, dir = "rtl", className = "",
  type = "text", inputMode,
}: Common & { type?: "text" | "email" | "tel" | "url"; inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"] }) {
  return (
    <TextField
      value={value}
      onChange={onChange}
      name={name}
      type={type}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      isRequired={required}
      isInvalid={!!error}
      fullWidth
      className={`textinput ${className}`.trim()}
    >
      <Label>{label}</Label>
      <Input placeholder={placeholder} dir={dir} inputMode={inputMode} />
      {error ? <FieldError>{error}</FieldError> : null}
    </TextField>
  );
}

/** A password field with a 44 px show/hide button at its end, so a password typed on a phone
 *  keyboard can be checked before it is sent. Left to right, like every password. */
export function PasswordInput({
  label, value, onChange, name, autoComplete, autoFocus, required, placeholder, error, className = "",
}: Omit<Common, "dir">) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      value={value}
      onChange={onChange}
      name={name}
      type={shown ? "text" : "password"}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      isRequired={required}
      isInvalid={!!error}
      fullWidth
      className={`textinput ${className}`.trim()}
    >
      <Label>{label}</Label>
      <InputGroup fullWidth>
        <InputGroup.Input placeholder={placeholder} dir="ltr" />
        <InputGroup.Suffix>
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            aria-label={shown ? "پنهان کردن رمز" : "نمایش رمز"}
            onPress={() => setShown((v) => !v)}
          >
            <Icon name={shown ? "eye-off" : "eye"} size="sm" />
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      {error ? <FieldError>{error}</FieldError> : null}
    </TextField>
  );
}
