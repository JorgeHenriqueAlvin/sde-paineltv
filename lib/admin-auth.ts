import { adminSessionKey, supabase } from "@/lib/supabase";

export type AdminIdentity = {
  username: string;
  mustChangePassword: boolean;
};

export type AdminUser = {
  id: string;
  username: string;
  active: boolean;
  createdAt: string;
};

function getToken() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(adminSessionKey);
}

export async function loginAdmin(username: string, password: string): Promise<AdminIdentity> {
  const { data, error } = await supabase.rpc("admin_login", { p_username: username, p_password: password });
  if (error) throw error;
  const session = data?.[0];
  if (!session?.token) throw new Error("Usuário ou senha inválidos. Após 5 tentativas, o acesso fica bloqueado por 15 minutos.");
  window.localStorage.setItem(adminSessionKey, session.token);
  return { username: session.username, mustChangePassword: Boolean(session.must_change_password) };
}

export async function validateAdminSession(): Promise<AdminIdentity | null> {
  const token = getToken();
  if (!token) return null;
  const { data, error } = await supabase.rpc("admin_validate_session", { p_token: token });
  if (error || !data?.[0]) {
    window.localStorage.removeItem(adminSessionKey);
    return null;
  }
  return { username: data[0].username, mustChangePassword: Boolean(data[0].must_change_password) };
}

export async function changeAdminPassword(password: string) {
  const token = getToken();
  if (!token) throw new Error("Sessão expirada.");
  const { error } = await supabase.rpc("admin_change_own_password", { p_token: token, p_new_password: password });
  if (error) throw error;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const token = getToken();
  if (!token) throw new Error("Sessão expirada.");
  const { data, error } = await supabase.rpc("admin_list_users", { p_token: token });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    username: String(row.username),
    active: Boolean(row.active),
    createdAt: String(row.created_at),
  }));
}

export async function createAdminUser(username: string, password: string) {
  const token = getToken();
  if (!token) throw new Error("Sessão expirada.");
  const { error } = await supabase.rpc("admin_create_user", { p_token: token, p_username: username, p_password: password });
  if (error) throw error;
}

export async function logoutAdmin() {
  const token = getToken();
  if (token) await supabase.rpc("admin_logout", { p_token: token });
  window.localStorage.removeItem(adminSessionKey);
}
