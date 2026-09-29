import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken, type Me } from "./api";

export function useMe() {
  return useQuery<Me>({ queryKey: ["me"], queryFn: () => api("/me"), enabled: !!getToken(), staleTime: 60_000 });
}

export function useAuthActions() {
  const qc = useQueryClient();
  return {
    async login(email: string, password: string) {
      const r = await api<Me & { token: string }>("/auth/login", { method: "POST", json: { email, password } });
      setToken(r.token);
      qc.setQueryData(["me"], r);
      return r;
    },
    async signup(body: { name: string; email: string; password: string; business_name: string }) {
      const r = await api<Me & { token: string }>("/auth/signup", { method: "POST", json: body });
      setToken(r.token);
      qc.setQueryData(["me"], r);
      return r;
    },
    async demo() {
      const r = await api<Me & { token: string }>("/auth/demo", { method: "POST" });
      setToken(r.token);
      qc.setQueryData(["me"], r);
      return r;
    },
    logout() {
      setToken(null);
      qc.clear();
      window.location.href = "/login";
    },
  };
}
