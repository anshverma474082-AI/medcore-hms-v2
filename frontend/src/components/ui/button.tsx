import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

const styles = cva('inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50', {
  variants: {
    variant: { primary: 'bg-teal px-4 py-2.5 text-white hover:bg-[#086d65]', secondary: 'border border-slate-200 bg-white px-4 py-2.5 text-ink hover:bg-slate-50', ghost: 'px-3 py-2 text-slate-600 hover:bg-slate-100', danger: 'bg-rose-600 px-4 py-2.5 text-white hover:bg-rose-700' },
    size: { default: '', small: 'px-3 py-1.5 text-xs', icon: 'h-10 w-10 p-0' },
  }, defaultVariants: { variant: 'primary', size: 'default' },
});
type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof styles> & { asChild?: boolean };
export function Button({ className, variant, size, asChild, ...props }: Props) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(styles({ variant, size }), className)} {...props} />;
}
