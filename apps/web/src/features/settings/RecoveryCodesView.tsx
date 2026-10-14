import { Copy, Download, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { toast } from '../../stores/toast';
import { copyText } from '../../utils/clipboard';
import { downloadBlob } from '../../utils/download';

/** Recovery codes, shown once: copy or download them, then confirm they're saved. */
export function RecoveryCodesView({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `Water Delivery – PIN recovery codes\nEach code works once. Keep them somewhere safe and private.\n\n${codes.join('\n')}\n`;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex gap-3 border-warn/30 bg-warn-bg p-4 text-sm text-warn">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">Save these codes now. They won't be shown again.</p>
          <p className="mt-1">
            If you lose your phone or authenticator app, one of these codes lets you reset your PIN. Each works once. Keep them private
            (e.g. a password manager, or written down at home), not in a WhatsApp chat.
          </p>
        </div>
      </Card>
      <Card className="p-4">
        <ol className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[17px] font-semibold tracking-wider text-ink" aria-label="Recovery codes">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
      </Card>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          icon={<Copy className="size-5" />}
          onClick={() => void copyText(codes.join('\n')).then((ok) => (ok ? toast.success('Recovery codes copied.') : toast.error("Couldn't copy. Write them down instead.")))}
        >
          Copy all
        </Button>
        <Button variant="secondary" icon={<Download className="size-5" />} onClick={() => downloadBlob('water-delivery-recovery-codes.txt', new Blob([text], { type: 'text/plain' }))}>
          Download
        </Button>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-5 accent-brand-700" />
        I've saved my recovery codes somewhere safe
      </label>
      <Button size="lg" block disabled={!saved} onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
