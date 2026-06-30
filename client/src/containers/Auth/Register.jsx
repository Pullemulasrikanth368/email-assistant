import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import fetchMethodRequest from '../../config/service';
import showToasterMessage from '../UI/ToasterMessage/toasterMessage';

const Register = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { name, email, password, confirmPassword } = form;

    if (!name.trim() || !email.trim() || !password.trim()) {
      showToasterMessage('All fields are required', 'error');
      return;
    }
    if (password !== confirmPassword) {
      showToasterMessage('Passwords do not match', 'error');
      return;
    }
    if (password.length < 8) {
      showToasterMessage('Password must be at least 8 characters', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetchMethodRequest('POST', 'auth/register', {
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (res && (res.respCode === 200 || res.respCode === 201) && res.accessToken) {
        localStorage.setItem('loginCredentials', JSON.stringify({
          accessToken: res.accessToken,
          email: res.email,
          name: res.name,
          role: res.role,
          _id: res._id,
        }));
        showToasterMessage(`Welcome, ${res.name || res.email}!`, 'success');
        navigate('/emailAnalysisMails', { replace: true });
      } else {
        showToasterMessage(res?.errorMessage || 'Registration failed. Please try again.', 'error');
      }
    } catch {
      showToasterMessage('Could not reach server. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left branding panel ─────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-[#0f172a] p-12 text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl" />
          <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl" />
        </div>

        <div className="relative z-10">
          <img src="/img/amneal_logo.png" alt="Amneal" className="h-10 brightness-0 invert" />
        </div>

        <div className="relative z-10 space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <Mail size={26} className="text-blue-400" />
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Join the<br />Executive Suite
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed max-w-sm">
            Create your account to start managing executive communications with AI-powered tools.
          </p>
          <div className="flex flex-col gap-3">
            {['AI-powered inbox triage', 'Automated daily briefs', 'Real-time operations reports'].map((f) => (
              <div key={f} className="flex items-center gap-2 text-slate-300 text-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                {f}
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-slate-500 text-xs">
          © {new Date().getFullYear()} Amneal Pharmaceuticals. All rights reserved.
        </p>
      </div>

      {/* ── Right form panel ────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Mail size={16} className="text-white" />
            </div>
            <span className="font-semibold text-slate-800">Executive Email Assistant</span>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-slate-900">Create account</h2>
              <p className="text-slate-500 text-sm mt-1">Fill in the details below to get started</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Full name */}
              <div className="space-y-1.5">
                <label htmlFor="name" className="text-sm font-medium text-slate-700">Full name</label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <Input
                    id="name"
                    type="text"
                    value={form.name}
                    onChange={set('name')}
                    placeholder="Jane Smith"
                    className="pl-9 h-10"
                    autoComplete="name"
                    autoFocus
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium text-slate-700">Email address</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    placeholder="you@company.com"
                    className="pl-9 h-10"
                    autoComplete="email"
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={set('password')}
                    placeholder="Min. 8 characters"
                    className="pl-9 pr-10 h-10"
                    autoComplete="new-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div className="space-y-1.5">
                <label htmlFor="confirmPassword" className="text-sm font-medium text-slate-700">Confirm password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={set('confirmPassword')}
                    placeholder="Re-enter your password"
                    className={`pl-9 h-10 ${form.confirmPassword && form.confirmPassword !== form.password ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </div>
                {form.confirmPassword && form.confirmPassword !== form.password && (
                  <p className="text-xs text-red-500">Passwords do not match</p>
                )}
              </div>

              <Button type="submit" className="w-full h-10 gap-2" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Creating account…
                  </>
                ) : (
                  <>
                    Create Account
                    <ArrowRight size={15} />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
