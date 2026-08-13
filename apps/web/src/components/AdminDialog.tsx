import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { unlockAdmin } from '../api';
import { Modal } from './Modal';

interface AdminDialogProps {
  onSuccess: () => void;
  onClose: () => void;
}

export function AdminDialog({ onSuccess, onClose }: AdminDialogProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const valid = await unlockAdmin(pin);
    setLoading(false);
    if (valid) onSuccess();
    else setError('Code administrateur incorrect.');
  }

  return (
    <Modal
      title="Accès administrateur"
      description="Saisissez votre code PIN à quatre chiffres pour accéder aux paramètres et modifier HomeDash."
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)} className="form-stack">
        <input
          className="sr-only"
          name="username"
          autoComplete="username"
          value="homedash-admin"
          readOnly
          tabIndex={-1}
        />
        <label className="field">
          <span>Code PIN</span>
          <div className="input-with-icon">
            <KeyRound size={20} />
            <input
              autoFocus
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              aria-label="Code PIN administrateur à quatre chiffres"
              placeholder="••••"
            />
          </div>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button button--primary button--full"
          type="submit"
          disabled={loading || pin.length !== 4}
        >
          {loading ? 'Vérification…' : 'Déverrouiller'}
        </button>
      </form>
    </Modal>
  );
}
