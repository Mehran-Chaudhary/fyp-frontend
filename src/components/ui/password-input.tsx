import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { Input } from './input';

type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'trailing'>;

/** Password field with a show/hide toggle. */
export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      trailing={
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="inline-flex size-8 items-center justify-center rounded-md text-faint transition-colors hover:bg-well hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-brand-500"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          tabIndex={0}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
}
