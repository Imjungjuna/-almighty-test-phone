import Image from "next/image";

import { cn } from "@/lib/utils";
import type { PhoneDefinition } from "@/lib/phones";

/** Yellow sticker matching the physical label on the phone. */
export function DeviceLabel({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-[3px] bg-label px-1.5 font-mono text-[0.72rem] font-semibold leading-5 text-label-foreground">
      {label}
    </span>
  );
}

export function DeviceSpec({ phone }: { phone: PhoneDefinition }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <DeviceLabel label={phone.label} />
      {phone.osVersion ? (
        <span className="font-mono font-semibold text-foreground">
          {phone.osVersion}
        </span>
      ) : (
        <span>{phone.platform === "ios" ? "아이폰" : "안드로이드"}</span>
      )}
    </span>
  );
}

export function DeviceImage({
  phone,
  className,
}: {
  phone: PhoneDefinition;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center justify-center overflow-hidden bg-well",
        className
      )}
    >
      <Image
        src={phone.image}
        alt=""
        width={phone.imageSize.width}
        height={phone.imageSize.height}
        className="h-full w-auto max-w-full object-contain mix-blend-multiply"
      />
    </span>
  );
}

type PhoneTileProps = {
  phone: PhoneDefinition;
  lastReturn: string;
  actionLabel: string;
  disabled: boolean;
  flash: boolean;
  onBorrow: () => void;
};

export function PhoneTile({
  phone,
  lastReturn,
  actionLabel,
  disabled,
  flash,
  onBorrow,
}: PhoneTileProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onBorrow}
      aria-label={`${phone.model} ${phone.label}, 대여 가능. ${actionLabel}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        flash && "motion-safe:animate-flash"
      )}
    >
      <DeviceImage phone={phone} className="h-28 p-3 sm:h-32" />
      <span className="flex flex-1 flex-col gap-1 p-3">
        <span className="text-base font-bold leading-tight tracking-tight">
          {phone.model}
        </span>
        <DeviceSpec phone={phone} />
        <span className="text-xs text-muted-foreground">{phone.color}</span>
        <span className="text-xs text-muted-foreground">
          마지막 반납 {lastReturn}
        </span>
        <span className="mt-auto pt-1.5 text-sm font-semibold text-status-ok group-hover:underline">
          {actionLabel}
        </span>
      </span>
    </button>
  );
}
