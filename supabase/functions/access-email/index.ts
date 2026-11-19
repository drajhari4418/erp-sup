import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in is required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const googleRefreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  const fromEmail = Deno.env.get("GOOGLE_SENDER_EMAIL");
  if (!supabaseUrl || !anonKey || !serviceKey || !googleClientId || !googleClientSecret || !googleRefreshToken || !fromEmail) {
    return json({ error: "Email service is not configured" }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Invalid sign-in" }, 401);

  let payload: { action?: string; user_id?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { action, user_id: targetId } = payload;
  if (!targetId || !["request", "approved"].includes(action || "")) {
    return json({ error: "Invalid email action" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sender, error: senderError } = await admin
    .from("profiles").select("id,full_name,email,role").eq("id", authData.user.id).single();
  if (senderError || !sender) return json({ error: "Sender profile was not found" }, 403);

  let subject: string;
  let html: string;
  let recipients: string[];
  if (action === "request") {
    if (targetId !== sender.id) return json({ error: "You can only notify for your own request" }, 403);
    const { data: accessRequest } = await admin
      .from("access_requests").select("user_id").eq("user_id", targetId).maybeSingle();
    if (!accessRequest) return json({ error: "Access request was not found" }, 404);
    const { data: admins, error: adminsError } = await admin
      .from("profiles").select("email").eq("role", "admin");
    if (adminsError) return json({ error: "Could not find ERP administrators" }, 500);
    recipients = [...new Set((admins || []).map((profile) => profile.email).filter(Boolean))];
    if (!recipients.length) return json({ error: "No administrator email is registered in Foundry ERP" }, 404);
    const name = escapeHtml(sender.full_name || sender.email || "A new user");
    const email = escapeHtml(sender.email || "");
    subject = "Foundry ERP access request";
    html = `<p>${name} (${email}) has requested access to Foundry ERP.</p><p>Sign in to Foundry ERP and open <strong>Users and access</strong> to review the request.</p>`;
  } else {
    if (sender.role !== "admin") return json({ error: "Administrator access is required" }, 403);
    const [{ data: recipient, error: recipientError }, { data: access }] = await Promise.all([
      admin.from("profiles").select("id,full_name,email").eq("id", targetId).single(),
      admin.from("module_access").select("user_id").eq("user_id", targetId).maybeSingle(),
    ]);
    if (recipientError || !recipient?.email) return json({ error: "User email was not found" }, 404);
    if (!access) return json({ error: "User access has not been granted" }, 409);
    recipients = [recipient.email];
    const name = escapeHtml(recipient.full_name || recipient.email);
    const appUrl = Deno.env.get("APP_URL");
    subject = "Your Foundry ERP access is approved";
    html = `<p>Hello ${name},</p><p>Your Foundry ERP access has been approved. You can now sign in and use the modules assigned to your account.</p>${appUrl ? `<p><a href="${escapeHtml(appUrl)}">Open Foundry ERP</a></p>` : ""}`;
    // Only an administrator can send approval messages; the recipient is the approved user's address.
  }

  return await sendEmail(googleClientId, googleClientSecret, googleRefreshToken, fromEmail, recipients, subject, html);
});

async function sendEmail(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fromEmail: string,
  to: string[],
  subject: string,
  html: string,
) {
  if (!isEmailAddress(fromEmail) || to.some((email) => !isEmailAddress(email))) {
    return json({ error: "A valid Gmail sender and recipient address are required" }, 400);
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text();
    return json({ error: `Google authorization failed (${tokenResponse.status}): ${detail}` }, 502);
  }

  const tokenData = await tokenResponse.json();
  if (typeof tokenData.access_token !== "string") {
    return json({ error: "Google did not return an access token" }, 502);
  }

  const mimeMessage = [
    `From: ${fromEmail}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(base64Encode(new TextEncoder().encode(html))),
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64UrlEncode(mimeMessage) }),
  });
  if (!response.ok) {
    const detail = await response.text();
    return json({ error: `Gmail rejected the message (${response.status}): ${detail}` }, 502);
  }

  return json({ sent: true });
}

function isEmailAddress(value: string) {
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) && !/[\r\n]/.test(value);
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function base64UrlEncode(value: string) {
  return base64Encode(new TextEncoder().encode(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
