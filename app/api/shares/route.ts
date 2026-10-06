import { createClient } from "@supabase/supabase-js";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function createClients(request: Request) {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error(
      "Sharing requires SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY on the server.",
    );
  }
  if (!token) {
    throw new Error("Sign in to manage sharing.");
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { authClient, adminClient, token };
}

async function getOwner(request: Request) {
  const clients = createClients(request);
  const { data, error } = await clients.authClient.auth.getUser(clients.token);
  if (error || !data.user) {
    throw new Error("Your session is invalid or has expired. Sign in again.");
  }
  return { ...clients, owner: data.user };
}

function getErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes("Sign in") || message.includes("session")
    ? 401
    : message.includes("requires ")
      ? 500
      : 400;
  return jsonError(message, status);
}

export async function GET(request: Request) {
  try {
    const { adminClient, owner } = await getOwner(request);
    const { data, error } = await adminClient
      .from("transaction_shares")
      .select("id, viewer_email, created_at")
      .eq("owner_id", owner.id)
      .order("created_at", { ascending: false });

    if (error) {
      return jsonError(`Unable to load shared users: ${error.message}`, 500);
    }
    return Response.json({ shares: data ?? [] });
  } catch (error) {
    return getErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { adminClient, owner } = await getOwner(request);
    const body: unknown = await request.json();
    const email =
      typeof body === "object" &&
      body !== null &&
      "email" in body &&
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError("Enter a valid email address.", 400);
    }
    if (owner.email?.toLowerCase() === email) {
      return jsonError("You already have access to your own ledger.", 400);
    }

    const perPage = 1000;
    let page = 1;
    let viewerId: string | undefined;
    while (!viewerId) {
      const { data, error } = await adminClient.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) {
        return jsonError(`Unable to find that account: ${error.message}`, 500);
      }
      const viewer = data.users.find(
        (user) => user.email?.toLowerCase() === email,
      );
      if (viewer) {
        viewerId = viewer.id;
        break;
      }
      if (data.users.length < perPage) break;
      page += 1;
    }

    if (!viewerId) {
      return jsonError(
        "No account uses that email yet. Ask them to sign up first, then try again.",
        404,
      );
    }

    const { data, error } = await adminClient
      .from("transaction_shares")
      .insert({
        owner_id: owner.id,
        owner_email: owner.email?.toLowerCase() ?? "",
        viewer_id: viewerId,
        viewer_email: email,
      })
      .select("id, viewer_email, created_at")
      .single();

    if (error?.code === "23505") {
      return jsonError("This user already has view access.", 409);
    }
    if (error) {
      return jsonError(`Unable to grant access: ${error.message}`, 500);
    }
    return Response.json({ share: data }, { status: 201 });
  } catch (error) {
    return getErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { adminClient, owner } = await getOwner(request);
    const body: unknown = await request.json();
    const shareId =
      typeof body === "object" &&
      body !== null &&
      "shareId" in body &&
      typeof body.shareId === "string"
        ? body.shareId
        : "";

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        shareId,
      )
    ) {
      return jsonError("Select a valid shared user to remove.", 400);
    }

    const { data, error } = await adminClient
      .from("transaction_shares")
      .delete()
      .eq("id", shareId)
      .eq("owner_id", owner.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return jsonError(`Unable to revoke access: ${error.message}`, 500);
    }
    if (!data) {
      return jsonError("That access grant was not found.", 404);
    }
    return Response.json({ success: true });
  } catch (error) {
    return getErrorResponse(error);
  }
}
