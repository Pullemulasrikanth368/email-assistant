import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

export const ProtectedRoute = ({ children }) => {
  const navigate = useNavigate();
  const isLoggedIn = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!isLoggedIn) {
      const redirectPath = `${location.pathname}${location.search}`;
      navigate("/login", { replace: true, state: { redirectPath } });
    }
  }, [isLoggedIn, navigate, location]);

  if (!isLoggedIn) return null;

  return children;
};
