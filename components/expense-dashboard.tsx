"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Plus,
  ReceiptText,
  Share2,
  Trash2,
  UserRoundPlus,
  Wallet,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

type Transaction = {
  id: string;
  user_id: string;
  date: string;
  type: "credit" | "debit";
  amount: number;
  tag: string;
  created_at: string;
};

type TransactionType = Transaction["type"];
type LedgerFilter = "all" | TransactionType;
type LedgerShare = {
  id: string;
  viewer_email: string;
  created_at: string;
};
type SharedLedger = {
  owner_id: string;
  owner_email: string;
};

const currency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const currencySymbol = "₹";
const chartColors = ["#26745c", "#d97656", "#d7a43c", "#6385a3", "#946e8d"];
const maxAmount = 9999999999.99;
const historyPageSize = 1000;

async function loadBalanceThroughMonth(
  client: SupabaseClient,
  month: string,
  ownerId: string,
) {
  let balance = 0;
  const throughDate = monthStartAfter(month);

  for (let offset = 0; ; offset += historyPageSize) {
    const { data, error } = await client
      .from("transactions")
      .select("id, type, amount")
      .eq("user_id", ownerId)
      .lt("date", throughDate)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + historyPageSize - 1);

    if (error) {
      throw new Error(`Unable to load balance to date: ${error.message}`);
    }

    for (const transaction of data ?? []) {
      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount)) {
        throw new Error("A transaction has an invalid amount.");
      }
      balance += transaction.type === "credit" ? amount : -amount;
    }

    if (!data || data.length < historyPageSize) {
      return balance;
    }
  }
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStartAfter(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return localDateString(new Date(year, monthNumber, 1));
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export default function ExpenseDashboard() {
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(() => Boolean(supabase));
  const [month, setMonth] = useState(() =>
    localDateString(new Date()).slice(0, 7),
  );
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [sharedLedgers, setSharedLedgers] = useState<SharedLedger[]>([]);
  const [activeLedgerOwnerId, setActiveLedgerOwnerId] = useState<string | null>(
    null,
  );
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [ownerShares, setOwnerShares] = useState<LedgerShare[]>([]);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
  const [shareError, setShareError] = useState("");
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [balanceThroughMonth, setBalanceThroughMonth] = useState<number | null>(
    null,
  );
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("all");
  const [deletingTransactionId, setDeletingTransactionId] = useState<
    string | null
  >(null);
  const [transactionToDelete, setTransactionToDelete] =
    useState<Transaction | null>(null);
  const [type, setType] = useState<TransactionType>("debit");
  const [date, setDate] = useState(() => localDateString(new Date()));
  const [amount, setAmount] = useState("");
  const [tag, setTag] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setTransactions([]);
        setBalanceThroughMonth(null);
        setSharedLedgers([]);
        setActiveLedgerOwnerId(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !session?.user) return;
    const client = supabase;
    const viewerId = session.user.id;
    let active = true;

    async function loadSharedLedgers() {
      const { data, error: sharesError } = await client
        .from("transaction_shares")
        .select("owner_id, owner_email")
        .eq("viewer_id", viewerId)
        .order("owner_email", { ascending: true });
      if (!active) return;
      if (sharesError) {
        setError(`Unable to load shared ledgers: ${sharesError.message}`);
        setSharedLedgers([]);
      } else {
        setSharedLedgers((data ?? []) as SharedLedger[]);
      }
    }

    void loadSharedLedgers();
    return () => {
      active = false;
    };
  }, [session?.user, supabase]);

  const ledgerOwnerId = activeLedgerOwnerId ?? session?.user.id;
  const viewingSharedLedger =
    Boolean(ledgerOwnerId) && ledgerOwnerId !== session?.user.id;

  useEffect(() => {
    if (!supabase || !session?.user || !ledgerOwnerId) return;

    const client = supabase;
    const ownerId = ledgerOwnerId;
    let active = true;
    async function loadMonthlyTransactions() {
      setTransactionsLoading(true);
      setError("");
      const { data, error: queryError } = await client
        .from("transactions")
        .select("id, user_id, date, type, amount, tag, created_at")
        .eq("user_id", ownerId)
        .gte("date", `${month}-01`)
        .lt("date", monthStartAfter(month))
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });

      if (!active) return;
      if (queryError) {
        setError(queryError.message);
        setTransactions([]);
      } else {
        setTransactions((data ?? []) as Transaction[]);
      }
      setTransactionsLoading(false);
    }

    async function loadCumulativeBalance() {
      setBalanceLoading(true);
      setBalanceThroughMonth(null);
      try {
        const balance = await loadBalanceThroughMonth(
          client,
          month,
          ownerId,
        );
        if (active) setBalanceThroughMonth(balance);
      } catch (balanceError) {
        if (active) {
          setError(
            balanceError instanceof Error
              ? balanceError.message
              : "Unable to load balance to date.",
          );
        }
      } finally {
        if (active) setBalanceLoading(false);
      }
    }

    void loadMonthlyTransactions();
    void loadCumulativeBalance();
    return () => {
      active = false;
    };
  }, [ledgerOwnerId, month, session?.user, supabase]);

  const totals = transactions.reduce(
    (result, transaction) => {
      const value = Number(transaction.amount);
      if (transaction.type === "credit") result.credit += value;
      else result.debit += value;
      return result;
    },
    { credit: 0, debit: 0 },
  );
  const visibleTransactions =
    ledgerFilter !== "all"
      ? transactions.filter((transaction) => transaction.type === ledgerFilter)
      : transactions;
  const expensesByTag = Object.values(
    transactions
      .filter((transaction) => transaction.type === "debit")
      .reduce<Record<string, { tag: string; amount: number }>>(
        (groups, transaction) => {
          const category = transaction.tag.trim() || "Uncategorized";
          groups[category] ??= { tag: category, amount: 0 };
          groups[category].amount += Number(transaction.amount);
          return groups;
        },
        {},
      ),
  ).sort((left, right) => right.amount - left.amount);

  async function callShareApi(
    method: "GET" | "POST" | "DELETE",
    body?: { email?: string; shareId?: string },
  ) {
    if (!session?.access_token) {
      throw new Error("Sign in again to manage ledger sharing.");
    }
    const response = await fetch("/api/shares", {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("error" in result || "shares" in result || "share" in result || "success" in result)
    ) {
      throw new Error("The sharing service returned an unexpected response.");
    }
    if (!response.ok) {
      throw new Error(
        "error" in result && typeof result.error === "string"
          ? result.error
          : `Sharing request failed (${response.status}).`,
      );
    }
    return result as {
      shares?: LedgerShare[];
      share?: LedgerShare;
      error?: string;
    };
  }

  async function openShareDialog() {
    setShareDialogOpen(true);
    setSharingBusy(true);
    setShareError("");
    try {
      const result = await callShareApi("GET");
      setOwnerShares(result.shares ?? []);
    } catch (loadError) {
      setShareError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load shared users.",
      );
    } finally {
      setSharingBusy(false);
    }
  }

  async function handleGrantAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSharingBusy(true);
    setShareError("");
    try {
      await callShareApi("POST", { email: shareEmail });
      setShareEmail("");
      const result = await callShareApi("GET");
      setOwnerShares(result.shares ?? []);
    } catch (grantError) {
      setShareError(
        grantError instanceof Error
          ? grantError.message
          : "Unable to grant view access.",
      );
    } finally {
      setSharingBusy(false);
    }
  }

  async function handleRevokeAccess(shareId: string) {
    setRevokingShareId(shareId);
    setShareError("");
    try {
      await callShareApi("DELETE", { shareId });
      setOwnerShares((current) =>
        current.filter((share) => share.id !== shareId),
      );
    } catch (revokeError) {
      setShareError(
        revokeError instanceof Error
          ? revokeError.message
          : "Unable to revoke view access.",
      );
    } finally {
      setRevokingShareId(null);
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setMessage("");
    const result =
      authMode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (result.error) setError(result.error.message);
    else if (authMode === "signup" && !result.data.session) {
      setMessage("Check your inbox to confirm your email, then sign in.");
    }
    setBusy(false);
  }

  async function handleAddTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !session?.user) return;
    const amountValue = Number(amount);
    if (
      !Number.isFinite(amountValue) ||
      amountValue === 0 ||
      Math.abs(amountValue) > maxAmount ||
      (type === "debit" && amountValue < 0)
    ) {
      setError(
        type === "credit"
          ? "Enter a non-zero income or loss amount within the supported limit."
          : "Expenses must be a positive amount.",
      );
      setMessage("");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    const { data, error: insertError } = await supabase
      .from("transactions")
      .insert({
        user_id: session.user.id,
        date,
        type,
        amount: amountValue,
        tag: tag.trim(),
      })
      .select("id, user_id, date, type, amount, tag, created_at")
      .single();

    if (insertError) {
      setError(insertError.message);
    } else {
      if (data.date >= `${month}-01` && data.date < monthStartAfter(month)) {
        setTransactions((current) =>
          [...current, data as Transaction].sort(
            (left, right) =>
              right.date.localeCompare(left.date) ||
              right.created_at.localeCompare(left.created_at),
          ),
        );
      }
      if (data.date < monthStartAfter(month)) {
        const value = Number(data.amount);
        const contribution = data.type === "credit" ? value : -value;
        setBalanceThroughMonth((current) =>
          current === null ? current : current + contribution,
        );
      }
      setAmount("");
      setTag("");
      setMessage("Transaction added.");
    }
    setBusy(false);
  }

  async function handleSignOut() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
  }

  async function handleDeleteTransaction() {
    if (
      !supabase ||
      !session?.user ||
      !transactionToDelete ||
      deletingTransactionId
    ) {
      return;
    }
    const transaction = transactionToDelete;

    setDeletingTransactionId(transaction.id);
    setError("");
    setMessage("");
    try {
      const { data, error: deleteError } = await supabase
        .from("transactions")
        .delete()
        .eq("id", transaction.id)
        .eq("user_id", session.user.id)
        .select("id")
        .maybeSingle();

      if (deleteError) {
        setError(`Unable to delete transaction: ${deleteError.message}`);
      } else if (!data) {
        setError(
          "Transaction was not deleted. It may already have been removed.",
        );
      } else {
        setTransactions((current) =>
          current.filter((item) => item.id !== transaction.id),
        );
        const amount = Number(transaction.amount);
        const contribution =
          transaction.type === "credit" ? amount : -amount;
        setBalanceThroughMonth((current) =>
          current === null ? current : current - contribution,
        );
        setTransactionToDelete(null);
        setMessage("Transaction deleted.");
      }
    } catch (deleteError) {
      setError(
        `Unable to delete transaction: ${
          deleteError instanceof Error ? deleteError.message : String(deleteError)
        }`,
      );
    } finally {
      setDeletingTransactionId(null);
      setTransactionToDelete(null);
    }
  }

  if (!supabase) {
    return (
      <main className="setup-screen">
        <div className="setup-panel">
          <div className="brand-mark">
            <Wallet size={22} />
          </div>
          <p className="eyebrow">Pennywise / Setup</p>
          <h1>Connect your Supabase project</h1>
          <p>
            Add your project URL and anon key to <code>.env.local</code>, then
            restart the development server.
          </p>
          <pre>
            {
              "NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key"
            }
          </pre>
          <p className="setup-note">
            Run the SQL in <code>supabase/schema.sql</code> before signing in.
          </p>
        </div>
      </main>
    );
  }

  if (authLoading) {
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" /> Loading your workspace...
      </div>
    );
  }

  if (!session) {
    return (
      <main className="auth-screen">
        <div className="auth-aside">
          <div className="brand-lockup">
            <span className="brand-mark">
              <Wallet size={21} />
            </span>
            <span>Pennywise</span>
          </div>
          <div className="auth-intro">
            <p className="eyebrow">Your money, in focus</p>
            <h1>A clearer view of where it goes.</h1>
            <p>
              Track everyday spending and income in one calm, organized ledger.
            </p>
          </div>
          <div className="aside-foot">
            <LockKeyhole size={15} /> Private to your account, protected by
            Supabase RLS
          </div>
        </div>
        <section className="auth-form-wrap">
          <form className="auth-form" onSubmit={handleAuth}>
            <p className="eyebrow">Welcome</p>
            <h2>
              {authMode === "signin"
                ? "Sign in to your account"
                : "Create your account"}
            </h2>
            <p className="auth-subtitle">
              Use your email address to access your personal ledger.
            </p>
            <label className="field-label" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={
                authMode === "signin" ? "current-password" : "new-password"
              }
              minLength={6}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
            <button
              className="primary-button auth-submit"
              type="submit"
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <LockKeyhole size={17} />
              )}
              {authMode === "signin" ? "Sign in" : "Create account"}
            </button>
            <p className="auth-switch">
              {authMode === "signin"
                ? "New to Pennywise?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === "signin" ? "signup" : "signin");
                  setError("");
                  setMessage("");
                }}
              >
                {authMode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="brand-lockup"
          href="#overview"
          aria-label="Pennywise home"
        >
          <span className="brand-mark">
            <Wallet size={21} />
          </span>
          <span>Pennywise</span>
        </a>
        <div className="topbar-right">
          {sharedLedgers.length > 0 && (
            <label className="ledger-picker">
              <span className="sr-only">Choose ledger</span>
              <select
                value={ledgerOwnerId}
                onChange={(event) => {
                  setTransactions([]);
                  setActiveLedgerOwnerId(event.target.value);
                }}
              >
                <option value={session.user.id}>My ledger</option>
                {sharedLedgers.map((ledger) => (
                  <option key={ledger.owner_id} value={ledger.owner_id}>
                    {ledger.owner_email
                      ? `${ledger.owner_email}'s ledger`
                      : "Shared ledger"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="month-picker">
            <CalendarDays size={16} />
            <span className="sr-only">Select month</span>
            <input
              type="month"
              value={month}
              onChange={(event) => {
                setTransactions([]);
                setMonth(event.target.value);
              }}
            />
          </label>
          <button
            className="share-access-button"
            type="button"
            onClick={() => void openShareDialog()}
          >
            <Share2 size={16} />
            <span>Share access</span>
          </button>
          <span className="account-email">{session.user.email}</span>
          <button
            className="icon-button"
            type="button"
            onClick={handleSignOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="dashboard-content" id="overview">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">Monthly overview</p>
            <h1>
              Your finances, <span>at a glance.</span>
            </h1>
          </div>
          <p className="month-caption">
            {new Intl.DateTimeFormat(undefined, {
              month: "long",
              year: "numeric",
            }).format(new Date(`${month}-15T12:00:00`))}
          </p>
          {viewingSharedLedger && (
            <p className="read-only-notice">
              <Wallet size={14} /> View-only ledger
            </p>
          )}
        </section>
        {error && (
          <p className="global-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="global-message" role="status">
            {message}
          </p>
        )}

        <section className="metrics-grid" aria-label="Monthly totals and balance">
          <article className="metric-card balance-card">
            <div className="metric-top">
              <span>Balance to date</span>
              <span className="metric-icon">
                <Wallet size={18} />
              </span>
            </div>
            <p className="metric-value">
              {balanceLoading || balanceThroughMonth === null
                ? "Loading..."
                : currency.format(balanceThroughMonth)}
            </p>
            <p className="metric-foot">Cumulative through selected month</p>
          </article>
          <article className="metric-card">
            <div className="metric-top">
              <span>Net balance this month</span>
              <span className="metric-icon">
                <Wallet size={18} />
              </span>
            </div>
            <p className="metric-value">{currency.format(totals.credit - totals.debit)}</p>
            <p className="metric-foot">Income minus expenses this month</p>
          </article>
          <article className="metric-card">
            <div className="metric-top">
              <span>Total income</span>
              <span className="metric-icon income-icon">
                <ArrowDownLeft size={18} />
              </span>
            </div>
            <p className="metric-value">{currency.format(totals.credit)}</p>
            <p className="metric-foot">
              {transactions.filter((item) => item.type === "credit").length}{" "}
              income/loss entries this month
            </p>
          </article>
          <article className="metric-card">
            <div className="metric-top">
              <span>Total expenses</span>
              <span className="metric-icon expense-icon">
                <ArrowUpRight size={18} />
              </span>
            </div>
            <p className="metric-value">{currency.format(totals.debit)}</p>
            <p className="metric-foot">
              {transactions.filter((item) => item.type === "debit").length}{" "}
              entries this month
            </p>
          </article>
        </section>

        <section className="workspace-grid">
          <div className="main-column">
            {!viewingSharedLedger && <section className="panel add-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Quick entry</p>
                  <h2>Add a transaction</h2>
                </div>
                <span className="heading-icon">
                  <Plus size={18} />
                </span>
              </div>
              <form
                className="transaction-form"
                onSubmit={handleAddTransaction}
              >
                <div
                  className="type-toggle"
                  role="group"
                  aria-label="Transaction type"
                >
                  <button
                    className={
                      type === "debit" ? "selected debit-selected" : ""
                    }
                    type="button"
                    onClick={() => setType("debit")}
                  >
                    <ArrowUpRight size={16} /> Expense
                  </button>
                  <button
                    className={
                      type === "credit" ? "selected credit-selected" : ""
                    }
                    type="button"
                    onClick={() => setType("credit")}
                  >
                    <ArrowDownLeft size={16} /> Income
                  </button>
                </div>
                <div className="form-fields">
                  <label>
                    <span>Date</span>
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </label>
                  <label className="amount-field">
                    <span>Amount</span>
                    <div className="amount-input">
                      <span>{currencySymbol}</span>
                      <input
                        type="number"
                        min={type === "credit" ? -maxAmount : "0.01"}
                        max={maxAmount}
                        step="0.01"
                        required
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder={type === "credit" ? "e.g. -50.00" : "0.00"}
                      />
                    </div>
                    {type === "credit" && (
                      <small className="field-hint">
                        Negative amount = loss.
                      </small>
                    )}
                  </label>
                  <label>
                    <span>Tag</span>
                    <input
                      type="text"
                      maxLength={60}
                      required
                      value={tag}
                      onChange={(event) => setTag(event.target.value)}
                      placeholder="e.g. groceries"
                    />
                  </label>
                  <button
                    className="primary-button add-button"
                    type="submit"
                    disabled={busy}
                  >
                    <Plus size={17} /> Add entry
                  </button>
                </div>
              </form>
            </section>}

            <section className="panel ledger-panel">
              <div className="panel-heading ledger-heading">
                <div>
                  <p className="eyebrow">Your activity</p>
                  <h2>Monthly ledger</h2>
                </div>
                <div className="ledger-controls">
                  <div
                    className="ledger-filter"
                    role="group"
                    aria-label="Filter transactions"
                  >
                    <button
                      type="button"
                      aria-pressed={ledgerFilter === "all"}
                      className={ledgerFilter === "all" ? "selected" : ""}
                      onClick={() => setLedgerFilter("all")}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      aria-pressed={ledgerFilter === "credit"}
                      className={ledgerFilter === "credit" ? "selected" : ""}
                      onClick={() => setLedgerFilter("credit")}
                    >
                      Credit
                    </button>
                    <button
                      type="button"
                      aria-pressed={ledgerFilter === "debit"}
                      className={ledgerFilter === "debit" ? "selected" : ""}
                      onClick={() => setLedgerFilter("debit")}
                    >
                      Expense
                    </button>
                  </div>
                  <span className="entry-count">
                    {visibleTransactions.length}{" "}
                    {visibleTransactions.length === 1 ? "entry" : "entries"}
                  </span>
                </div>
              </div>
              {transactionsLoading ? (
                <div className="empty-state">
                  <LoaderCircle className="spin" size={22} />
                  <p>Loading transactions...</p>
                </div>
              ) : visibleTransactions.length === 0 ? (
                <div className="empty-state">
                  <ReceiptText size={25} />
                  <p>
                    {ledgerFilter === "credit"
                      ? "No credit transactions for this month."
                      : ledgerFilter === "debit"
                        ? "No expense transactions for this month."
                        : "No transactions for this month yet."}
                  </p>
                  {ledgerFilter === "all" && (
                    <span>Add an entry above to start your ledger.</span>
                  )}
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Transaction</th>
                        <th>Date</th>
                        <th className="amount-column">Amount</th>
                        {!viewingSharedLedger && (
                          <th>
                            <span className="visually-hidden">Actions</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTransactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td>
                            <div className="transaction-name">
                              <span
                                className={`transaction-icon ${transaction.type}`}
                                aria-hidden="true"
                              >
                                {transaction.type === "credit" ? (
                                  <ArrowDownLeft size={16} />
                                ) : (
                                  <ArrowUpRight size={16} />
                                )}
                              </span>
                              <span>
                                <strong>{transaction.tag}</strong>
                                <small>
                                  {transaction.type === "credit"
                                    ? Number(transaction.amount) < 0
                                      ? "Loss"
                                      : "Income"
                                    : "Expense"}
                                </small>
                              </span>
                            </div>
                          </td>
                          <td className="date-cell">
                            {formatDate(transaction.date)}
                          </td>
                          <td
                            className={`amount-cell ${transaction.type} ${
                              transaction.type === "credit" &&
                              Number(transaction.amount) < 0
                                ? "loss"
                                : ""
                            }`}
                          >
                            {transaction.type === "credit" &&
                            Number(transaction.amount) < 0
                              ? currency.format(Number(transaction.amount))
                              : `${transaction.type === "credit" ? "+" : "−"}${currency.format(Math.abs(Number(transaction.amount)))}`}
                          </td>
                          {!viewingSharedLedger && (
                            <td className="transaction-actions-cell">
                              <button
                                className="delete-transaction-button"
                                type="button"
                                aria-label={`Delete ${transaction.tag} ${transaction.type} transaction`}
                                title="Delete transaction"
                                disabled={deletingTransactionId !== null}
                                onClick={() =>
                                  setTransactionToDelete(transaction)
                                }
                              >
                                {deletingTransactionId === transaction.id ? (
                                  <LoaderCircle className="spin" size={16} />
                                ) : (
                                  <Trash2 size={16} />
                                )}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="side-column">
            <section className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Cash flow</p>
                  <h2>Income vs. expenses</h2>
                </div>
                <span className="heading-icon">
                  <ChartNoAxesCombined size={18} />
                </span>
              </div>
              <div className="bar-chart-wrap">
                {transactions.length === 0 ? (
                  <div className="chart-empty">
                    Monthly comparison appears here
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={[
                        {
                          name: "This month",
                          income: totals.credit,
                          expenses: totals.debit,
                        },
                      ]}
                      barGap={10}
                    >
                      <CartesianGrid vertical={false} stroke="#e8ece6" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#818982", fontSize: 12 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        width={48}
                        tick={{ fill: "#818982", fontSize: 11 }}
                        tickFormatter={(value: number) => currency.format(value)}
                      />
                      <Tooltip
                        formatter={(value) => currency.format(Number(value))}
                        cursor={{ fill: "#f2f5f0" }}
                      />
                      <Bar
                        dataKey="income"
                        name="Income"
                        fill="#26745c"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={42}
                      />
                      <Bar
                        dataKey="expenses"
                        name="Expenses"
                        fill="#d97656"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={42}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="chart-legend">
                <span>
                  <i className="legend-income" />
                  Income
                </span>
                <span>
                  <i className="legend-expenses" />
                  Expenses
                </span>
              </div>
            </section>

            <section className="panel chart-panel distribution-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Spending habits</p>
                  <h2>By category</h2>
                </div>
                <span className="heading-icon">
                  <CircleDollarSign size={18} />
                </span>
              </div>
              {expensesByTag.length === 0 ? (
                <div className="pie-empty">
                  <div className="pie-empty-ring">
                    <CircleDollarSign size={23} />
                  </div>
                  <p>No expenses to break down</p>
                  <span>Expense tags will appear here.</span>
                </div>
              ) : (
                <>
                  <div className="pie-chart-wrap">
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie
                          data={expensesByTag}
                          dataKey="amount"
                          nameKey="tag"
                          innerRadius={53}
                          outerRadius={78}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {expensesByTag.map((item, index) => (
                            <Cell
                              key={item.tag}
                              fill={chartColors[index % chartColors.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) => currency.format(Number(value))}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="category-list">
                    {expensesByTag.slice(0, 5).map((item, index) => (
                      <div className="category-row" key={item.tag}>
                        <span>
                          <i
                            style={{
                              backgroundColor:
                                chartColors[index % chartColors.length],
                            }}
                          />
                          {item.tag}
                        </span>
                        <strong>{currency.format(item.amount)}</strong>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </aside>
        </section>
        <footer className="dashboard-footer">
          <span>Pennywise</span>
          <span>
            <LockKeyhole size={13} /> Your data stays yours
          </span>
        </footer>
      </div>
      {shareDialogOpen && (
        <div
          className="confirm-overlay"
          onClick={() => {
            if (!sharingBusy && revokingShareId === null) {
              setShareDialogOpen(false);
            }
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              !sharingBusy &&
              revokingShareId === null
            ) {
              setShareDialogOpen(false);
            }
          }}
        >
          <section
            className="confirm-dialog share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="share-dialog-close"
              type="button"
              aria-label="Close sharing settings"
              disabled={sharingBusy || revokingShareId !== null}
              onClick={() => setShareDialogOpen(false)}
            >
              <X size={18} />
            </button>
            <div className="confirm-icon share-dialog-icon">
              <UserRoundPlus size={21} />
            </div>
            <h2 id="share-dialog-title">Share view-only access</h2>
            <p>
              Add someone with an existing Pennywise account. They can view your
              ledger, but cannot add, change, or delete your transactions.
            </p>
            <form className="share-form" onSubmit={handleGrantAccess}>
              <label htmlFor="share-email">Account email</label>
              <div className="share-form-row">
                <input
                  id="share-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={shareEmail}
                  onChange={(event) => setShareEmail(event.target.value)}
                  placeholder="person@example.com"
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={sharingBusy || !shareEmail.trim()}
                >
                  {sharingBusy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Share2 size={16} />
                  )}
                  Grant access
                </button>
              </div>
            </form>
            {shareError && (
              <p className="share-error" role="alert">
                {shareError}
              </p>
            )}
            <div className="shared-users">
              <h3>People with access</h3>
              {sharingBusy && ownerShares.length === 0 ? (
                <p className="shared-users-empty">Loading access list...</p>
              ) : ownerShares.length === 0 ? (
                <p className="shared-users-empty">
                  No one has access to your ledger yet.
                </p>
              ) : (
                <ul>
                  {ownerShares.map((share) => (
                    <li key={share.id}>
                      <span>
                        <strong>{share.viewer_email}</strong>
                        <small>Can view only</small>
                      </span>
                      <button
                        className="revoke-access-button"
                        type="button"
                        disabled={
                          sharingBusy || revokingShareId !== null
                        }
                        onClick={() => void handleRevokeAccess(share.id)}
                      >
                        {revokingShareId === share.id ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          "Remove"
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
      {transactionToDelete && (
        <div
          className="confirm-overlay"
          onClick={() => {
            if (deletingTransactionId === null) setTransactionToDelete(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && deletingTransactionId === null) {
              setTransactionToDelete(null);
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-icon">
              <Trash2 size={21} />
            </div>
            <h2 id="delete-dialog-title">Delete this transaction?</h2>
            <p id="delete-dialog-description">
              This will permanently delete the{" "}
              {transactionToDelete.type === "credit"
                ? Number(transactionToDelete.amount) < 0
                  ? "loss"
                  : "income"
                : "expense"}{" "}
              below. This action can’t be undone.
            </p>
            <div className="confirm-transaction">
              <span>
                <strong>{transactionToDelete.tag}</strong>
                <small>
                  {formatDate(transactionToDelete.date)} ·{" "}
                  {transactionToDelete.type === "credit"
                    ? Number(transactionToDelete.amount) < 0
                      ? "Loss"
                      : "Income"
                    : "Expense"}
                </small>
              </span>
              <strong
                className={
                  transactionToDelete.type === "debit" ||
                  Number(transactionToDelete.amount) < 0
                    ? "confirm-amount negative"
                    : "confirm-amount"
                }
              >
                {transactionToDelete.type === "credit" &&
                Number(transactionToDelete.amount) >= 0
                  ? "+"
                  : ""}
                {transactionToDelete.type === "debit" ? "−" : ""}
                {currency.format(Math.abs(Number(transactionToDelete.amount)))}
              </strong>
            </div>
            <div className="confirm-actions">
              <button
                className="cancel-delete-button"
                type="button"
                autoFocus
                disabled={deletingTransactionId !== null}
                onClick={() => setTransactionToDelete(null)}
              >
                Keep transaction
              </button>
              <button
                className="confirm-delete-button"
                type="button"
                disabled={deletingTransactionId !== null}
                onClick={() => void handleDeleteTransaction()}
              >
                {deletingTransactionId !== null ? (
                  <>
                    <LoaderCircle className="spin" size={16} />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete transaction
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
