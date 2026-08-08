import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-[var(--ds-space-actions)] rounded-md text-control leading-control font-semibold whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "border border-input bg-raised text-secondary-foreground shadow-xs hover:bg-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--ds-control-md-height)] px-[var(--ds-control-md-padding-x)]",
        xs: "h-[var(--ds-tag-height)] gap-1 px-1.5 text-label [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-[var(--ds-control-sm-height)] px-[var(--ds-control-sm-padding-x)] text-meta",
        lg: "h-[var(--ds-row-md-height)] px-3 text-nav",
        icon: "size-[var(--ds-control-md-height)]",
        "icon-xs": "size-[var(--ds-icon-sm)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[var(--ds-control-sm-height)]",
        "icon-lg": "size-[var(--ds-row-md-height)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
