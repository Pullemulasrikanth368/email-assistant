import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

export const ProtectedRoute = ({ condition, errorComponent: ErrorComponent, children }) => {
  const navigate = useNavigate();
  const isLoggedIn = useAuth();
  const location = useLocation();

  useEffect(() => {
    const redirectPath = `${location.pathname}${location.search}`
    if (!isLoggedIn) {
      navigate("/login-request", { state: { redirectPath } });
    } else if (!condition) {
      navigate("/no-permission");
    }
  }, [isLoggedIn, condition, navigate]);

  if (!isLoggedIn || !condition) return null; 

  return children;
};
