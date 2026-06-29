import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { Password } from 'primereact/password';
import fetchMethodRequest from '../../config/service';
import showToasterMessage from '../UI/ToasterMessage/toasterMessage';
import './Login.scss';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const redirectPath = location.state?.redirectPath || '/emailAnalysisMails';

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      showToasterMessage('Email and password are required', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetchMethodRequest('POST', 'auth/login', { email: email.trim(), password });

      if (res && res.respCode === 200 && res.accessToken) {
        localStorage.setItem('loginCredentials', JSON.stringify({
          accessToken: res.accessToken,
          email: res.email,
          name: res.name,
          role: res.role,
          _id: res._id,
        }));
        showToasterMessage(`Welcome back, ${res.name || res.email}!`, 'success');
        navigate(redirectPath, { replace: true });
      } else {
        const msg = res?.errorMessage || 'Invalid email or password';
        showToasterMessage(msg, 'error');
      }
    } catch {
      showToasterMessage('Could not reach server. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ea-login-page">
      <div className="ea-login-card">
        {/* Header */}
        <div className="ea-login-header">
          <div className="ea-login-icon">
            <i className="pi pi-envelope" style={{ fontSize: '2rem', color: '#1a73e8' }} />
          </div>
          <h1 className="ea-login-title">Executive Email Assistant</h1>
          <p className="ea-login-subtitle">Sign in to your account</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="ea-login-form">
          <div className="ea-field">
            <label htmlFor="email" className="ea-label">Email address</label>
            <InputText
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="ea-input"
              autoComplete="email"
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="ea-field">
            <label htmlFor="password" className="ea-label">Password</label>
            <Password
              inputId="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="ea-input"
              toggleMask
              feedback={false}
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <Button
            type="submit"
            label={loading ? 'Signing in…' : 'Sign In'}
            icon={loading ? 'pi pi-spin pi-spinner' : 'pi pi-sign-in'}
            className="ea-login-btn"
            disabled={loading}
          />
        </form>
      </div>
    </div>
  );
};

export default Login;
