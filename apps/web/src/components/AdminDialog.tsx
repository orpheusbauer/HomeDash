import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { verifyAdminToken } from '../api';
import { Modal } from './Modal';

interface AdminDialogProps {
  onSuccess: () => void;
  onClose: () => void;
}

export function AdminDialog({ onSuccess, onClose }: AdminDialogProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const valid = await verifyAdminToken(token);
    setLoading(false);
    if (valid) onSuccess();
    else setError('Code administrateur incorrect.');
  }

  return (
    <Modal
      title="Déverrouiller le mode édition"
      description="Ce code protège les changements importants sur votre réseau local."
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
          <span>Code administrateur</span>
          <div className="input-with-icon">
            <KeyRound size={20} />
            <input
              autoFocus
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="current-password"
              placeholder="Votre jeton HomeDash"
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
          disabled={loading || token.length < 1}
        >
          {loading ? 'Vérification…' : 'Déverrouiller'}
        </button>
      </form>
    </Modal>
  );
}
