import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const GD_TAGS = ["GD", "ES添削", "模擬面接", "誰でも歓迎", "フレンドのみ"];
const METHODS = ["オンライン", "対面", "オンライン・対面どちらも可"];
const SAFE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createFriendCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += SAFE_CODE_CHARS[Math.floor(Math.random() * SAFE_CODE_CHARS.length)];
  }
  return code;
}

function dateInputToMonthDay(value) {
  if (!value) return "";
  const parts = value.split("-");
  if (parts.length !== 3) return "";
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function monthDayToDateInput(monthDay) {
  const parts = String(monthDay || "").split("/");
  if (parts.length !== 2) return "";
  const year = new Date().getFullYear();
  const month = String(Number(parts[0])).padStart(2, "0");
  const day = String(Number(parts[1])).padStart(2, "0");
  if (month === "NaN" || day === "NaN") return "";
  return `${year}-${month}-${day}`;
}

function getMonthDayKey(session) {
  const parts = String(session.monthDay || "").split("/");
  if (parts.length !== 2) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  if (!month || !day) return null;
  return `${month}/${day}`;
}

function getSessionDate(session) {
  const key = getMonthDayKey(session);
  if (!key || !session.time) return null;
  const [month, day] = key.split("/").map(Number);
  const [hour, minute] = String(session.time).split(":").map(Number);
  if (!hour && hour !== 0) return null;
  const date = new Date(new Date().getFullYear(), month - 1, day, hour, minute || 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDeleteDate(session) {
  const date = getSessionDate(session);
  if (!date) return null;
  const deleteDate = new Date(date);
  deleteDate.setHours(deleteDate.getHours() + 10);
  return deleteDate;
}

function isExpiredSession(session) {
  const deleteDate = getDeleteDate(session);
  return deleteDate ? new Date() >= deleteDate : false;
}

function formatDateTime(session) {
  if (!session.monthDay && !session.time) return "日時未設定";
  return `${session.monthDay || ""} ${session.time || ""}`.trim();
}

function formatDeleteDate(session) {
  const date = getDeleteDate(session);
  if (!date) return "削除予定：日時未設定";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `削除予定：${month}/${day} ${hour}:${minute}`;
}

function getNotificationStatus() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function parseMemo(rawMemo) {
  const lines = String(rawMemo || "").split("
");
  const data = {
    duration: "",
    method: "オンライン",
    condition: "",
    tags: [],
    note: "",
  };

  const noteLines = [];

  lines.forEach((line) => {
    if (line.startsWith("所要時間：")) data.duration = line.replace("所要時間：", "").trim();
    else if (line.startsWith("実施方法：")) data.method = line.replace("実施方法：", "").trim();
    else if (line.startsWith("参加条件：")) data.condition = line.replace("参加条件：", "").trim();
    else if (line.startsWith("タグ：")) data.tags = line.replace("タグ：", "").split("、").filter(Boolean);
    else if (line.trim()) noteLines.push(line);
  });

  data.note = noteLines.join("
").trim();
  return data;
}

function buildMemo(session) {
  return [
    session.duration ? `所要時間：${session.duration}` : "",
    session.method ? `実施方法：${session.method}` : "",
    session.condition ? `参加条件：${session.condition}` : "",
    session.tags?.length ? `タグ：${session.tags.join("、")}` : "",
    session.memo || "",
  ]
    .filter(Boolean)
    .join("
");
}

function fromSupabase(row) {
  const extra = parseMemo(row.memo || "");
  return {
    id: row.id,
    type: row.type || "GD練習",
    title: row.title || "GDテーマ未設定",
    theme: row.theme || row.title || "",
    monthDay: row.month_day || "",
    time: row.time || "",
    maxParticipants: row.max_participants || 6,
    maxObservers: row.max_observers || 1,
    zoomUrl: row.zoom_url || "",
    memo: extra.note,
    duration: extra.duration,
    method: extra.method || "オンライン",
    condition: extra.condition,
    tags: extra.tags,
    createdBy: row.created_by,
    createdByName: row.created_by_name || "不明",
    ownerUserId: row.owner_user_id,
    visibility: row.visibility || "public",
    participants: Array.isArray(row.participants) ? row.participants : [],
    observers: Array.isArray(row.observers) ? row.observers : [],
    createdAt: row.created_at,
  };
}

function toSupabase(session) {
  return {
    type: session.type || "GD練習",
    title: session.title,
    theme: session.theme || session.title,
    month_day: session.monthDay,
    time: session.time,
    max_participants: Number(session.maxParticipants) || 6,
    max_observers: 1,
    zoom_url: session.zoomUrl || "",
    memo: buildMemo(session),
    participants: session.participants || [],
    observers: session.observers || [],
    created_by: session.createdBy,
    created_by_name: session.createdByName,
    owner_user_id: session.ownerUserId,
    visibility: session.visibility || "public",
  };
}

function buildShareText(session) {
  const url = window.location.origin;
  return [
    "【GD練習募集】",
    `GDテーマ：${session.title}`,
    `日時：${formatDateTime(session)}`,
    `参加人数：${session.participants.length}/${session.maxParticipants}`,
    `対象：${session.condition || "指定なし"}`,
    `形式：${session.method || "オンライン"}`,
    session.duration ? `所要時間：${session.duration}` : "",
    session.tags.length ? `タグ：${session.tags.join("、")}` : "",
    "",
    `参加はこちら：${url}`,
  ]
    .filter(Boolean)
    .join("
");
}

async function shareSession(session) {
  const text = buildShareText(session);
  const url = window.location.origin;
  try {
    if (navigator.share) {
      await navigator.share({ title: session.title, text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text}
${url}`);
    alert("募集リンクをコピーしました。好きなアプリに貼り付けて共有できます。");
  } catch (error) {
    console.error(error);
  }
}

function getHashError() {
  const raw = window.location.hash ? window.location.hash.slice(1) : "";
  const params = new URLSearchParams(raw);
  const code = params.get("error_code");
  if (!code) return null;
  if (code === "otp_expired") return "ログインリンクの有効期限が切れています";
  if (code === "access_denied") return "認証に失敗しました";
  return "エラーが発生しました。もう一度お試しください";
}

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [authError, setAuthError] = useState(getHashError());
  const [currentPage, setCurrentPage] = useState("home");
  const [sessions, setSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [dbError, setDbError] = useState("");
  const [profile, setProfile] = useState(null);
  const [profileDraft, setProfileDraft] = useState({ name: "", hasZoomLicense: false });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [allProfiles, setAllProfiles] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [foundProfile, setFoundProfile] = useState(null);
  const [friendMessage, setFriendMessage] = useState("");
  const [notificationStatus, setNotificationStatus] = useState(getNotificationStatus);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [selectedSearchTags, setSelectedSearchTags] = useState([]);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("gd_dark_mode") === "true");
  const [newSession, setNewSession] = useState({
    type: "GD練習",
    title: "",
    theme: "",
    monthDay: "",
    time: "",
    maxParticipants: 6,
    duration: "60分",
    method: "オンライン",
    condition: "",
    visibility: "public",
    zoomUrl: "",
    memo: "",
    tags: [],
  });

  useEffect(() => {
    localStorage.setItem("gd_dark_mode", String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setAuthUser(data.session?.user || null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user || null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    initializeUser();
    loadEverything();
    const timer = setInterval(loadEverything, 60 * 1000);
    const channel = supabase
      .channel("app_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "gd_sessions" }, loadSessions)
      .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, loadFriendRequests)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, loadProfiles)
      .subscribe();
    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [authUser]);

  const friendIds = useMemo(() => {
    if (!authUser) return new Set();
    const ids = new Set();
    friendRequests
      .filter((r) => r.status === "accepted")
      .forEach((r) => {
        if (r.from_user_id === authUser.id) ids.add(r.to_user_id);
        if (r.to_user_id === authUser.id) ids.add(r.from_user_id);
      });
    return ids;
  }, [friendRequests, authUser]);

  const friends = useMemo(() => allProfiles.filter((p) => friendIds.has(p.id)), [allProfiles, friendIds]);
  const incomingRequests = useMemo(
    () => (authUser ? friendRequests.filter((r) => r.to_user_id === authUser.id && r.status === "pending") : []),
    [friendRequests, authUser]
  );
  const outgoingRequests = useMemo(
    () => (authUser ? friendRequests.filter((r) => r.from_user_id === authUser.id && r.status === "pending") : []),
    [friendRequests, authUser]
  );

  const sortedSessions = useMemo(() => {
    if (!authUser) return sessions;
    function priority(session) {
      const members = [...session.participants, ...session.observers];
      if (session.ownerUserId === authUser.id) return 4;
      if (members.some((p) => friendIds.has(p.id))) return 3;
      if (friendIds.has(session.ownerUserId)) return 2;
      return 1;
    }
    return [...sessions].sort(
      (a, b) => priority(b) - priority(a) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
  }, [sessions, friendIds, authUser]);

  const filteredSessions = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return sortedSessions.filter((session) => {
      const members = [...session.participants, ...session.observers];
      const friendInRoom = members.some((p) => friendIds.has(p.id));
      const friendCreated = friendIds.has(session.ownerUserId);
      const hasJoined = members.some((p) => p.id === authUser?.id);
      const text = [
        session.type,
        session.title,
        session.theme,
        session.createdByName,
        session.monthDay,
        session.time,
        session.memo,
        session.method,
        session.condition,
        ...session.tags,
      ]
        .join(" ")
        .toLowerCase();

      const keywordOK = !keyword || text.includes(keyword);
      let tagOK = true;

      if (selectedTag === "available") tagOK = session.participants.length < session.maxParticipants;
      if (selectedTag === "friendRelated") tagOK = friendInRoom || friendCreated;
      if (selectedTag === "joined") tagOK = hasJoined;

      if (selectedSearchTags.includes("GD")) {
        tagOK = tagOK && (session.type === "GD練習" || session.tags.includes("GD"));
      }
      if (selectedSearchTags.includes("ES添削")) {
        tagOK = tagOK && (session.type === "ES添削会" || session.tags.includes("ES添削"));
      }
      if (selectedSearchTags.includes("模擬面接")) {
        tagOK = tagOK && (session.type === "模擬面接会" || session.tags.includes("模擬面接"));
      }
      if (selectedSearchTags.includes("誰でも歓迎")) {
        tagOK = tagOK && session.tags.includes("誰でも歓迎");
      }
      if (selectedSearchTags.includes("フレンドのみ")) {
        tagOK = tagOK && (session.visibility === "friends" || session.tags.includes("フレンドのみ"));
      }

      return keywordOK && tagOK;
    });
  }, [sortedSessions, searchKeyword, selectedTag, selectedSearchTags, friendIds, authUser]);

  const calendarDays = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    return [...Array.from({ length: firstDay }, () => null), ...Array.from({ length: lastDate }, (_, i) => i + 1)];
  }, [calendarDate]);

  const calendarSessionMap = useMemo(() => {
    const map = new Map();
    const currentMonth = calendarDate.getMonth() + 1;
    sessions.forEach((session) => {
      const key = getMonthDayKey(session);
      if (!key) return;
      const month = Number(key.split("/")[0]);
      if (month !== currentMonth) return;
      map.set(key, [...(map.get(key) || []), session]);
    });
    return map;
  }, [sessions, calendarDate]);

  const selectedCalendarSessions = useMemo(
    () => (selectedCalendarDate ? sortedSessions.filter((s) => getMonthDayKey(s) === selectedCalendarDate) : []),
    [selectedCalendarDate, sortedSessions]
  );

  function moveCalendarMonth(amount) {
    setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
    setSelectedCalendarDate(null);
  }

  function moveCalendarYear(amount) {
    setCalendarDate((current) => new Date(current.getFullYear() + amount, current.getMonth(), 1));
    setSelectedCalendarDate(null);
  }

  function resetCalendarToCurrentMonth() {
    setCalendarDate(new Date());
    setSelectedCalendarDate(null);
  }

  function setTag(tag) {
    if (tag === "all") {
      setSelectedTag("all");
      setSelectedSearchTags([]);
      setCurrentPage("rooms");
      return;
    }

    if (GD_TAGS.includes(tag)) {
      setSelectedSearchTags((current) =>
        current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
      );
      setCurrentPage("rooms");
      return;
    }

    setSelectedTag((current) => (current === tag ? "all" : tag));
    setCurrentPage("rooms");
  }

  async function signUp() {
    if (!authForm.email.trim() || !authForm.password.trim()) return alert("メールアドレスとパスワードを入力してください");
    const { error } = await supabase.auth.signUp({ email: authForm.email.trim(), password: authForm.password });
    if (error) return alert(error.message);
    alert("登録できました。ログインしてください。");
    setAuthMode("login");
  }

  async function signIn() {
    if (!authForm.email.trim() || !authForm.password.trim()) return alert("メールアドレスとパスワードを入力してください");
    const { error } = await supabase.auth.signInWithPassword({ email: authForm.email.trim(), password: authForm.password });
    if (error) alert(error.message);
  }

  async function resendAuthEmail() {
    if (!authForm.email.trim()) return alert("メールアドレスを入力してください");
    const { error } = await supabase.auth.resend({ type: "signup", email: authForm.email.trim() });
    if (error) return alert("メールの再送信に失敗しました。もう一度お試しください");
    alert("メールを再送信しました");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setAuthUser(null);
    setProfile(null);
    setSessions([]);
    setCurrentPage("home");
  }

  async function initializeUser() {
    if (!authUser) return;
    const { data, error } = await supabase.from("user_profiles").select("*").eq("id", authUser.id).maybeSingle();
    if (error) return console.error(error);
    if (data) {
      if (!data.friend_code) {
        const { data: updated, error: updateError } = await supabase
          .from("user_profiles")
          .update({ friend_code: createFriendCode(), updated_at: new Date().toISOString() })
          .eq("id", authUser.id)
          .select()
          .single();
        if (updateError) return console.error(updateError);
        setProfile(updated);
        setProfileDraft({ name: updated.name, hasZoomLicense: updated.has_zoom_license });
        setIsEditingProfile(updated.name === "未設定");
        return;
      }
      setProfile(data);
      setProfileDraft({ name: data.name, hasZoomLicense: data.has_zoom_license });
      setIsEditingProfile(data.name === "未設定");
      return;
    }
    let inserted = null;
    let insertError = null;
    for (let i = 0; i < 5; i++) {
      const result = await supabase
        .from("user_profiles")
        .insert({ id: authUser.id, friend_code: createFriendCode(), name: "未設定", has_zoom_license: false })
        .select()
        .single();
      inserted = result.data;
      insertError = result.error;
      if (!insertError) break;
    }
    if (insertError) return alert("プロフィール作成に失敗しました。もう一度お試しください");
    setProfile(inserted);
    setProfileDraft({ name: inserted.name, hasZoomLicense: inserted.has_zoom_license });
    setIsEditingProfile(true);
  }

  async function loadEverything() {
    await Promise.all([loadProfiles(), loadFriendRequests(), loadSessions()]);
  }

  async function loadProfiles() {
    const { data, error } = await supabase.from("user_profiles").select("*").order("created_at", { ascending: false });
    if (error) return console.error(error);
    setAllProfiles(data || []);
  }

  async function loadFriendRequests() {
    if (!authUser) return;
    const { data, error } = await supabase
      .from("friend_requests")
      .select("*")
      .or(`from_user_id.eq.${authUser.id},to_user_id.eq.${authUser.id}`)
      .order("created_at", { ascending: false });
    if (error) return console.error(error);
    setFriendRequests(data || []);
  }

  async function deleteExpiredSessions(targetSessions) {
    const expired = targetSessions.filter(isExpiredSession);
    if (!expired.length) return targetSessions;
    const ids = expired.map((s) => s.id);
    const { error } = await supabase.from("gd_sessions").delete().in("id", ids);
    if (error) return targetSessions;
    return targetSessions.filter((s) => !ids.includes(s.id));
  }

  async function loadSessions() {
    setIsLoadingSessions(true);
    setDbError("");
    const { data, error } = await supabase.from("gd_sessions").select("*").order("created_at", { ascending: false });
    if (error) {
      setDbError("募集データの読み込みに失敗しました。もう一度お試しください");
      setIsLoadingSessions(false);
      return;
    }
    const active = await deleteExpiredSessions((data || []).map(fromSupabase));
    setSessions(active);
    setIsLoadingSessions(false);
  }

  async function saveProfile() {
    if (!profileDraft.name.trim()) return alert("名前を入力してください");
    const { data, error } = await supabase
      .from("user_profiles")
      .update({ name: profileDraft.name.trim(), has_zoom_license: profileDraft.hasZoomLicense, updated_at: new Date().toISOString() })
      .eq("id", authUser.id)
      .select()
      .single();
    if (error) return alert("プロフィール保存に失敗しました。もう一度お試しください");
    setProfile(data);
    setProfileDraft({ name: data.name, hasZoomLicense: data.has_zoom_license });
    setIsEditingProfile(false);
    await loadProfiles();
  }

  function requireProfile() {
    if (!profile || !profile.name || profile.name === "未設定") {
      alert("先にプロフィールを登録してください");
      setCurrentPage("profile");
      setIsEditingProfile(true);
      return false;
    }
    return true;
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) return alert("このブラウザは通知に対応していません");
    const permission = await Notification.requestPermission();
    setNotificationStatus(permission);
    if (permission === "granted") new Notification("通知がオンになりました", { body: "募集人数に達したときに通知します。" });
  }

  async function createSession(event) {
    event.preventDefault();
    if (!requireProfile()) return;
    if (!newSession.title.trim() || !newSession.monthDay.trim() || !newSession.time) {
      return alert("GDテーマ、日付、時間を入力してください");
    }
    const session = {
      ...newSession,
      title: newSession.title.trim(),
      theme: newSession.title.trim(),
      memo: newSession.memo.trim(),
      maxObservers: 1,
      createdBy: authUser.id,
      createdByName: profile.name,
      ownerUserId: authUser.id,
      participants: [],
      observers: [],
    };
    const { data, error } = await supabase.from("gd_sessions").insert(toSupabase(session)).select().single();
    if (error) return alert("募集作成に失敗しました。もう一度お試しください");
    setSessions((current) => [fromSupabase(data), ...current]);
    setNewSession({
      type: "GD練習",
      title: "",
      theme: "",
      monthDay: "",
      time: "",
      maxParticipants: 6,
      duration: "60分",
      method: "オンライン",
      condition: "",
      visibility: "public",
      zoomUrl: "",
      memo: "",
      tags: [],
    });
    setCurrentPage("rooms");
    await loadSessions();
  }

  function canJoinSession(session) {
    if (session.ownerUserId === authUser.id) return true;
    if (session.visibility !== "friends") return true;
    return friendIds.has(session.ownerUserId);
  }

  async function joinSession(sessionId, joinType) {
    if (!requireProfile()) return;
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    if (!canJoinSession(target)) return alert("この募集はフレンド限定です");
    if ([...target.participants, ...target.observers].some((p) => p.id === authUser.id)) return alert("参加中です");
    const profileData = { id: authUser.id, name: profile.name, hasZoomLicense: profile.has_zoom_license };
    const participants = [...target.participants];
    const observers = [...target.observers];
    if (joinType === "observer") {
      if (observers.length >= target.maxObservers) return alert("見学枠は満員です");
      observers.push(profileData);
    } else {
      if (participants.length >= target.maxParticipants) return alert("満員です");
      participants.push(profileData);
    }
    const { data, error } = await supabase.from("gd_sessions").update({ participants, observers }).eq("id", sessionId).select().single();
    if (error) return alert("参加に失敗しました。もう一度お試しください");
    setSessions((current) => current.map((s) => (s.id === sessionId ? fromSupabase(data) : s)));
    await loadSessions();
  }

  async function leaveSession(sessionId) {
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    const participants = target.participants.filter((p) => p.id !== authUser.id);
    const observers = target.observers.filter((p) => p.id !== authUser.id);
    const { data, error } = await supabase.from("gd_sessions").update({ participants, observers }).eq("id", sessionId).select().single();
    if (error) return alert("参加取り消しに失敗しました。もう一度お試しください");
    setSessions((current) => current.map((s) => (s.id === sessionId ? fromSupabase(data) : s)));
  }

  async function deleteSession(sessionId) {
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    if (target.ownerUserId !== authUser.id) return alert("削除できるのは作成者のみです");
    if (!confirm("この募集を削除しますか？")) return;
    const { error } = await supabase.from("gd_sessions").delete().eq("id", sessionId);
    if (error) return alert("削除に失敗しました。もう一度お試しください");
    setSessions((current) => current.filter((s) => s.id !== sessionId));
  }

  async function resetAllSessions() {
    if (!confirm("自分が作成した募集をすべて削除しますか？")) return;
    const { error } = await supabase.from("gd_sessions").delete().eq("owner_user_id", authUser.id);
    if (error) return alert("初期化に失敗しました。もう一度お試しください");
    await loadSessions();
  }

  async function searchFriendByCode() {
    setFriendMessage("");
    setFoundProfile(null);
    const code = friendCodeInput.trim().toUpperCase();
    if (!code) return alert("フレンドIDを入力してください");
    const { data, error } = await supabase.from("user_profiles").select("*").eq("friend_code", code).maybeSingle();
    if (error) return setFriendMessage("検索に失敗しました。もう一度お試しください");
    if (!data) return setFriendMessage("該当するユーザーが見つかりませんでした");
    if (data.id === authUser.id) return setFriendMessage("自分自身には申請できません");
    setFoundProfile(data);
  }

  async function sendFriendRequest(targetProfile) {
    const existing = friendRequests.find(
      (r) =>
        (r.from_user_id === authUser.id && r.to_user_id === targetProfile.id) ||
        (r.from_user_id === targetProfile.id && r.to_user_id === authUser.id)
    );
    if (existing) return alert(existing.status === "accepted" ? "すでにフレンドです" : "申請中です");
    const { error } = await supabase.from("friend_requests").insert({
      from_user_id: authUser.id,
      to_user_id: targetProfile.id,
      status: "pending",
    });
    if (error) return alert("申請に失敗しました。もう一度お試しください");
    setFoundProfile(null);
    setFriendCodeInput("");
    setFriendMessage("フレンド申請を送りました");
    await loadFriendRequests();
  }

  async function acceptFriendRequest(id) {
    const { error } = await supabase.from("friend_requests").update({ status: "accepted" }).eq("id", id);
    if (error) return alert("承認に失敗しました。もう一度お試しください");
    await loadFriendRequests();
  }

  async function deleteFriendRequest(id) {
    const { error } = await supabase.from("friend_requests").delete().eq("id", id);
    if (error) return alert("削除に失敗しました。もう一度お試しください");
    await loadFriendRequests();
  }

  function getProfileName(userId) {
    return allProfiles.find((p) => p.id === userId)?.name || "不明";
  }

  function toggleNewSessionTag(tag) {
    setNewSession((current) => {
      const exists = current.tags.includes(tag);
      const nextTags = exists ? current.tags.filter((item) => item !== tag) : [...current.tags, tag];
      const nextSession = { ...current, tags: nextTags };

      if (tag === "GD" && !exists) nextSession.type = "GD練習";
      if (tag === "ES添削" && !exists) nextSession.type = "ES添削会";
      if (tag === "模擬面接" && !exists) nextSession.type = "模擬面接会";
      if (tag === "フレンドのみ" && !exists) nextSession.visibility = "friends";
      if (tag === "誰でも歓迎" && !exists) nextSession.visibility = "public";

      return nextSession;
    });
  }

  function renderSessionCard(session, compact = false) {
    const isOwner = session.ownerUserId === authUser?.id;
    const canJoin = canJoinSession(session);
    const hasJoined = [...session.participants, ...session.observers].some((p) => p.id === authUser?.id);
    const isFull = session.participants.length >= session.maxParticipants;
    const friendCreated = friendIds.has(session.ownerUserId);
    const friendInRoom = [...session.participants, ...session.observers].some((p) => friendIds.has(p.id));

    return (
      <div className="card sessionCard" key={session.id}>
        <div className="sessionTop">
          <div className="sessionMain">
            <p className="dateHero">{formatDateTime(session)}</p>
            <h3>{session.title}</h3>
            <div className="gdInfoGrid">
              <div><span>GDテーマ</span><strong>{session.title}</strong></div>
              <div><span>日時</span><strong>{formatDateTime(session)}</strong></div>
              <div><span>参加人数</span><strong>{session.participants.length}/{session.maxParticipants}人</strong></div>
              <div><span>対象</span><strong>{session.condition || "指定なし"}</strong></div>
              <div><span>形式</span><strong>{session.method || "オンライン"}</strong></div>
              <div><span>所要時間</span><strong>{session.duration || "未設定"}</strong></div>
            </div>
            <div className="badgeArea">
              <span className={session.visibility === "friends" ? "badge yellow" : "badge blue"}>
                {session.visibility === "friends" ? "フレンド限定" : "全員公開"}
              </span>
              {friendCreated && <span className="badge green">フレンド作成</span>}
              {friendInRoom && <span className="badge green">フレンド参加中</span>}
              {session.tags.map((tag) => <span className="badge" key={tag}>{tag}</span>)}
            </div>
            <p className="meta">投稿者：{session.createdByName}</p>
            <p className="meta">{formatDeleteDate(session)}</p>
            {session.zoomUrl && (
              <p className="meta">参加リンク：<a href={session.zoomUrl} target="_blank" rel="noreferrer">開く</a></p>
            )}
            {session.memo && <p className="memo">{session.memo}</p>}
            {!canJoin && <p className="lockedText">フレンド限定です</p>}
          </div>
          {!compact && (
            <div className="actions">
              {hasJoined ? (
                <button className="subButton" onClick={() => leaveSession(session.id)}>参加中</button>
              ) : (
                <button className="mainButton" disabled={isFull || !canJoin} onClick={() => joinSession(session.id, "participant")}>
                  {isFull ? "満員" : "参加"}
                </button>
              )}
              {!hasJoined && (
                <button className="observerButton" onClick={() => joinSession(session.id, "observer")} disabled={!canJoin || session.observers.length >= session.maxObservers}>
                  見学
                </button>
              )}
              <button className="shareButton" onClick={() => shareSession(session)}>共有</button>
              {isOwner ? <button className="dangerButton" onClick={() => deleteSession(session.id)}>削除</button> : <p className="ownerOnlyText">削除は作成者のみ</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!supabase) {
    return (
      <div className={darkMode ? "app dark" : "app"}>
        <style>{styles}</style>
        <div className="authCard"><h1>GD Practice</h1><p>Supabaseの環境変数が設定されていません。もう一度お試しください</p></div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className={darkMode ? "app dark" : "app"}>
        <style>{styles}</style>
        <main className="authLayout">
          <div className="authCard">
            <h1 className="appTitle">GD Practice</h1>
            {authError && (
              <div className="errorBox">
                <strong>{authError}</strong>
                <p>もう一度お試しください</p>
                <div className="buttonRow">
                  <button className="subButton" onClick={() => { window.location.hash = ""; setAuthError(null); setAuthMode("login"); }}>ログイン画面へ戻る</button>
                  <button className="mainButton" onClick={resendAuthEmail}>メールを再送信する</button>
                </div>
              </div>
            )}
            <p className="description">グループディスカッションの練習相手を探せるアプリ</p>
            <div className="authTabs">
              <button className={authMode === "login" ? "choice active" : "choice"} onClick={() => setAuthMode("login")}>ログイン</button>
              <button className={authMode === "signup" ? "choice active" : "choice"} onClick={() => setAuthMode("signup")}>新規登録</button>
            </div>
            <div className="formArea">
              <label>メール<input type="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} placeholder="example@email.com" /></label>
              <label>パスワード<input type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} placeholder="6文字以上" /></label>
              <button className="mainButton full" onClick={authMode === "login" ? signIn : signUp}>{authMode === "login" ? "ログイン" : "新規登録"}</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={darkMode ? "app dark" : "app"}>
      <style>{styles}</style>
      <header className="hero compactHero">
        <h1 className="appTitle">GD Practice</h1>
        <p className="shortDescription">グループディスカッションの練習相手を探せるアプリ</p>
        {currentPage !== "home" && <button className="subButton" onClick={() => setCurrentPage("home")}>ホーム</button>}
      </header>
      {dbError && <div className="alert">{dbError}</div>}

      {currentPage === "home" && (
        <main className="homeLayout">
          <section className="homeCard">
            <div className="homeSearch">
              <input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} placeholder="GDテーマ・対象・形式で検索" />
              <button className="mainButton" onClick={() => setCurrentPage("rooms")}>検索</button>
            </div>
            <div className="tagArea">
              {["all", ...GD_TAGS, "available"].map((tag) => {
                const active = tag === "all"
                  ? selectedTag === "all" && selectedSearchTags.length === 0
                  : GD_TAGS.includes(tag)
                    ? selectedSearchTags.includes(tag)
                    : selectedTag === tag;

                return (
                  <button key={tag} className={active ? "tagButton active" : "tagButton"} onClick={() => setTag(tag)}>
                    {tag === "all" ? "すべて" : tag === "available" ? "空きあり" : tag}
                  </button>
                );
              })}
            </div>
            <div className="homeMenu">
              <button className="homeButton primary" onClick={() => setCurrentPage("create")}><span>募集作成</span><small>GD練習相手を募集</small></button>
              <button className="homeButton" onClick={() => setCurrentPage("rooms")}><span>募集一覧</span><small>練習会を探す</small></button>
              <button className="homeButton" onClick={() => setCurrentPage("friends")}><span>フレンド</span><small>ID検索・申請</small></button>
              <button className="homeButton" onClick={() => setCurrentPage("profile")}><span>プロフィール</span><small>名前・Zoom設定</small></button>
              <button className="homeButton" onClick={() => setCurrentPage("settings")}><span>設定</span><small>表示・通知</small></button>
              <button className="homeButton" onClick={() => setCurrentPage("help")}><span>使い方</span><small>操作説明</small></button>
            </div>
          </section>
          <section className="card calendarCard">
            <div className="calendarHeader">
              <button className="subButton" onClick={() => moveCalendarYear(-1)}>前年</button>
              <button className="subButton" onClick={() => moveCalendarMonth(-1)}>前月</button>
              <h2>{calendarDate.getFullYear()}年 {calendarDate.getMonth() + 1}月のGD練習</h2>
              <button className="subButton" onClick={() => moveCalendarMonth(1)}>次月</button>
              <button className="subButton" onClick={() => moveCalendarYear(1)}>翌年</button>
              <button className="mainButton" onClick={resetCalendarToCurrentMonth}>今月</button>
            </div>
            <p className="settingText">色付きの日＝募集あり</p>
            <div className="calendarWeekdays">{["日", "月", "火", "水", "木", "金", "土"].map((d) => <span key={d}>{d}</span>)}</div>
            <div className="calendarGrid">{calendarDays.map((day, index) => {
              if (!day) return <div className="calendarBlank" key={`blank-${index}`} />;
              const key = `${calendarDate.getMonth() + 1}/${day}`;
              const count = (calendarSessionMap.get(key) || []).length;
              const selected = selectedCalendarDate === key;
              return (
                <button key={key} className={count ? selected ? "calendarDay hasSession selected" : "calendarDay hasSession" : selected ? "calendarDay selected" : "calendarDay"} onClick={() => setSelectedCalendarDate(key)}>
                  <strong>{day}</strong>{count > 0 && <small>{count}件</small>}
                </button>
              );
            })}</div>
            <div className="calendarResult">
              <h3>{selectedCalendarDate ? `${selectedCalendarDate}の募集` : "日付を選択"}</h3>
              {!selectedCalendarDate ? <p className="emptyText">色付きの日をタップすると、その日の募集だけ確認できます。</p> : selectedCalendarSessions.length ? selectedCalendarSessions.map((s) => renderSessionCard(s, true)) : <p className="emptyText">この日の募集はまだありません</p>}
            </div>
          </section>
          <section className="homeLogoutArea"><button className="dangerButton" onClick={signOut}>ログアウト</button></section>
        </main>
      )}

      {currentPage === "create" && (
        <main className="singleLayout"><div className="card"><h2>GD募集作成</h2><form className="createForm" onSubmit={createSession}>
          <label>開催日<input type="date" value={monthDayToDateInput(newSession.monthDay)} onChange={(e) => setNewSession({ ...newSession, monthDay: dateInputToMonthDay(e.target.value) })} /></label>
          <label>開始時間<input type="time" value={newSession.time} onChange={(e) => setNewSession({ ...newSession, time: e.target.value })} /></label>
          <label>募集人数<input type="number" min="1" max="12" value={newSession.maxParticipants} onChange={(e) => setNewSession({ ...newSession, maxParticipants: e.target.value })} /></label>
          <label>所要時間<select value={newSession.duration} onChange={(e) => setNewSession({ ...newSession, duration: e.target.value })}><option>30分</option><option>45分</option><option>60分</option><option>90分</option><option>120分</option></select></label>
          <label>実施方法<select value={newSession.method} onChange={(e) => setNewSession({ ...newSession, method: e.target.value })}>{METHODS.map((method) => <option key={method}>{method}</option>)}</select></label>
          <label>公開範囲<select value={newSession.visibility} onChange={(e) => setNewSession({ ...newSession, visibility: e.target.value })}><option value="public">全員公開</option><option value="friends">フレンド限定</option></select></label>
          <label className="wide">GDテーマ<input value={newSession.title} onChange={(e) => setNewSession({ ...newSession, title: e.target.value })} placeholder="例：大学生向けの新サービスを考える" /></label>
          <label className="wide">参加条件<input value={newSession.condition} onChange={(e) => setNewSession({ ...newSession, condition: e.target.value })} placeholder="例：初心者歓迎、就活対策中の大学生" /></label>
          <div className="wide"><p className="formLabel">タグ</p><div className="tagArea">{GD_TAGS.map((tag) => <button type="button" key={tag} className={newSession.tags.includes(tag) ? "tagButton active" : "tagButton"} onClick={() => toggleNewSessionTag(tag)}>{tag}</button>)}</div></div>
          <label className="wide">参加リンク<input value={newSession.zoomUrl} onChange={(e) => setNewSession({ ...newSession, zoomUrl: e.target.value })} placeholder="Zoom / Meet / Teamsなど 任意" /></label>
          <label className="wide">補足説明<textarea value={newSession.memo} onChange={(e) => setNewSession({ ...newSession, memo: e.target.value })} placeholder="進め方、フィードバックの有無、準備物など" /></label>
          <div className="buttonRow wide"><button className="mainButton" type="submit">募集作成</button><button className="subButton" type="button" onClick={() => setCurrentPage("home")}>戻る</button></div>
        </form></div></main>
      )}

      {currentPage === "rooms" && (
        <main className="singleLayout"><div className="card listHeader"><div><h2>募集一覧</h2><p>GDテーマ・日時・参加人数・対象・形式を確認できます。</p></div><div className="countBox">{isLoadingSessions ? "読み込み中" : `${filteredSessions.length}/${sessions.length}件`}</div></div><div className="card searchPanel"><label>検索<input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} placeholder="GDテーマ・対象・形式で検索" /></label><div className="tagArea">{["all", "available", "friendRelated", "joined", ...GD_TAGS].map((tag) => {
                const active = tag === "all"
                  ? selectedTag === "all" && selectedSearchTags.length === 0
                  : GD_TAGS.includes(tag)
                    ? selectedSearchTags.includes(tag)
                    : selectedTag === tag;

                return (
                  <button key={tag} className={active ? "tagButton active" : "tagButton"} onClick={() => setTag(tag)}>
                    {tag === "all" ? "すべて" : tag === "available" ? "空きあり" : tag === "friendRelated" ? "フレンド関連" : tag === "joined" ? "参加中" : tag}
                  </button>
                );
              })}</div></div><div className="sessionList">{filteredSessions.length ? filteredSessions.map((s) => renderSessionCard(s)) : <div className="card empty">条件に合う募集が見つかりませんでした</div>}</div></main>
      )}

      {currentPage === "friends" && (
        <main className="singleLayout"><div className="card"><h2>フレンド</h2><div className="friendIdBox"><span>あなたのID</span><strong>{profile?.friend_code || "作成中..."}</strong><button className="subButton" onClick={() => navigator.clipboard.writeText(profile?.friend_code || "")}>IDをコピー</button><button className="shareButton" onClick={() => navigator.share ? navigator.share({ text: `私のフレンドID：${profile?.friend_code}` }) : navigator.clipboard.writeText(profile?.friend_code || "")}>共有</button><button className="subButton" onClick={() => navigator.clipboard.writeText(window.location.origin)}>リンクをコピー</button></div><p className="settingText">Oと0、Iと1、Lなど見間違えやすい文字は使いません。</p><div className="settingSection"><h3>ID検索</h3><div className="searchRow"><input value={friendCodeInput} onChange={(e) => setFriendCodeInput(e.target.value.toUpperCase())} placeholder="例：ABC234" /><button className="mainButton" onClick={searchFriendByCode}>検索</button></div>{friendMessage && <p className="settingText">{friendMessage}</p>}{foundProfile && <div className="friendCard"><strong>{foundProfile.name}</strong><span>ID：{foundProfile.friend_code}</span><button className="mainButton" onClick={() => sendFriendRequest(foundProfile)}>申請</button></div>}</div><div className="settingSection"><h3>届いた申請</h3>{incomingRequests.length ? incomingRequests.map((r) => <div className="participant" key={r.id}><strong>{getProfileName(r.from_user_id)}</strong><div className="smallButtonRow"><button className="mainButton" onClick={() => acceptFriendRequest(r.id)}>承認</button><button className="dangerButton" onClick={() => deleteFriendRequest(r.id)}>拒否</button></div></div>) : <p className="emptyText">届いている申請はありません</p>}</div><div className="settingSection"><h3>フレンド一覧</h3>{friends.length ? friends.map((f) => <div className="participant" key={f.id}><strong>{f.name}</strong><span className="badge">{f.friend_code}</span></div>) : <p className="emptyText">まだフレンドはいません</p>}</div></div></main>
      )}

      {currentPage === "profile" && (
        <main className="singleLayout"><div className="card"><div className="cardHeader"><h2>プロフィール</h2>{!isEditingProfile && <button className="subButton" onClick={() => setIsEditingProfile(true)}>編集</button>}</div>{isEditingProfile ? <div className="formArea"><label>名前<input value={profileDraft.name} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} placeholder="例：田中太郎" /></label><div><p className="formLabel">Zoomライセンス</p><div className="choiceArea"><button type="button" className={profileDraft.hasZoomLicense ? "choice active" : "choice"} onClick={() => setProfileDraft({ ...profileDraft, hasZoomLicense: true })}>あり</button><button type="button" className={!profileDraft.hasZoomLicense ? "choice active" : "choice"} onClick={() => setProfileDraft({ ...profileDraft, hasZoomLicense: false })}>なし</button></div></div><button className="mainButton full" onClick={saveProfile}>保存</button></div> : <div className="profileBox"><p>名前：<strong>{profile?.name}</strong></p><p>フレンドID：<strong>{profile?.friend_code || "作成中..."}</strong></p><p>Zoom：<strong>{profile?.has_zoom_license ? "あり" : "なし"}</strong></p></div>}</div></main>
      )}

      {currentPage === "settings" && (
        <main className="singleLayout"><div className="card"><h2>設定</h2><div className="settingSection"><h3>表示</h3><button className="mainButton full" onClick={() => setDarkMode(!darkMode)}>{darkMode ? "ライトモード" : "ダークモード"}</button><p className="settingText">ダークモードでは青を使わず、黒・白・グレー中心で表示します。</p></div><div className="settingSection"><h3>通知</h3>{notificationStatus === "granted" ? <p className="notificationBox ok">通知は許可されています</p> : <button className="mainButton full" onClick={requestNotificationPermission}>通知許可</button>}</div><div className="settingSection"><h3>データ</h3><button className="dangerButton full" onClick={resetAllSessions}>自分の募集を初期化</button></div></div></main>
      )}

      {currentPage === "help" && (
        <main className="singleLayout"><div className="card"><h2>使い方</h2><ol className="steps large"><li>プロフィールを保存します。</li><li>募集作成でGDテーマ・日時・人数・形式を入力します。</li><li>募集一覧から練習相手を探して参加します。</li><li>タグは複数選択できます。</li><li>共有から好きな媒体に募集を送れます。</li></ol></div></main>
      )}
    </div>
  );
}

const styles = `
* { box-sizing: border-box; }
:root { --accent:#2563eb; --accent-soft:#eff6ff; --text:#172033; --subtext:#64748b; --border:#e2e8f0; --white:#ffffff; --success-bg:#ecfdf3; --success-text:#166534; --warn-bg:#fff7ed; --warn-text:#9a3412; --danger:#be123c; }
body { margin:0; background:#f8fafc; color:var(--text); font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
button,input,textarea,select { font:inherit; }
button { cursor:pointer; transition:.2s ease; }
button:hover { transform:translateY(-1px); }
button:disabled { cursor:not-allowed; opacity:.5; transform:none; }
.app { min-height:100vh; padding:24px; background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%); }
.dark { --accent:#f4f4f5; --accent-soft:#18181b; --text:#f9fafb; --subtext:#d4d4d8; --border:#3f3f46; --white:#09090b; --success-bg:#18181b; --success-text:#f4f4f5; --warn-bg:#18181b; --warn-text:#e4e4e7; --danger:#fca5a5; background:#000; color:#f9fafb; }
.dark.app { background:#000; }
.dark .appTitle { color:#f9fafb; }
.dark .mainButton,.dark .homeButton.primary,.dark .tagButton.active,.dark .calendarDay.selected,.dark .dateHero { background:#f4f4f5; color:#09090b; border-color:#f4f4f5; }
.dark .tagButton,.dark .shareButton,.dark .observerButton,.dark .calendarDay.hasSession { background:#18181b; color:#f4f4f5; border-color:#3f3f46; }
.dark input,.dark textarea,.dark select,.dark .calendarDay,.dark .gdInfoGrid div,.dark .memo,.dark .emptyText,.dark .friendCard,.dark .friendIdBox,.dark .participant,.dark .calendarSessionItem { background:#18181b; color:#f9fafb; }
.alert,.errorBox { max-width:1180px; margin:0 auto 18px; padding:14px 16px; background:#fff1f2; border:1px solid #ffe4e6; color:var(--danger); border-radius:16px; font-weight:800; }
.authLayout { min-height:92vh; display:flex; align-items:center; justify-content:center; }
.authCard,.homeCard,.card { background:var(--white); border:1px solid var(--border); border-radius:24px; padding:28px; box-shadow:0 12px 32px rgba(37,99,235,.06); }
.authCard { width:100%; max-width:560px; text-align:center; }
.authTabs,.choiceArea { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:18px 0; }
.hero { max-width:1180px; margin:0 auto 20px; padding:26px 28px; background:var(--white); border:1px solid var(--border); border-radius:28px; box-shadow:0 12px 32px rgba(37,99,235,.06); display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px; }
.appTitle { margin:0; font-size:40px; line-height:1.05; color:#1d4ed8; letter-spacing:-.02em; }
.shortDescription,.description { margin:0; color:var(--subtext); line-height:1.7; font-weight:700; }
.homeLayout,.singleLayout { max-width:1180px; margin:0 auto; }
.singleLayout { display:flex; flex-direction:column; gap:18px; }
.homeCard { padding:34px; }
.homeSearch { display:flex; gap:10px; margin-bottom:14px; }
.homeMenu,.summaryGrid { margin-top:24px; display:grid; grid-template-columns:repeat(2,1fr); gap:18px; }
.homeButton { border:1px solid var(--border); border-radius:22px; padding:24px; background:var(--white); color:var(--text); text-align:left; display:flex; flex-direction:column; gap:8px; font-weight:900; }
.homeButton.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.homeButton span { font-size:20px; }
.homeButton small { opacity:.85; font-weight:700; }
h2 { margin:0 0 16px; font-size:28px; color:var(--text); }
h3 { margin:12px 0 8px; font-size:22px; color:var(--text); }
.formArea,.participants,.sessionList { display:flex; flex-direction:column; gap:12px; }
label { display:flex; flex-direction:column; gap:8px; font-weight:800; color:var(--text); text-align:left; }
input,textarea,select { width:100%; border:1px solid var(--border); border-radius:16px; padding:14px 15px; outline:none; background:#fbfdff; color:#111827; font-weight:700; min-height:48px; }
input::placeholder,textarea::placeholder { color:#94a3b8; }
input:focus,textarea:focus,select:focus { border-color:var(--accent); box-shadow:0 0 0 4px rgba(37,99,235,.12); }
textarea { min-height:96px; resize:vertical; }
.formLabel { margin:0 0 8px; font-weight:900; }
.choice,.mainButton,.subButton,.dangerButton,.observerButton,.shareButton,.tagButton { border:1px solid transparent; border-radius:14px; padding:12px 16px; font-weight:900; }
.choice,.subButton { background:var(--white); color:var(--accent); border-color:#bfdbfe; }
.choice.active,.mainButton { background:var(--accent); color:#fff; border-color:var(--accent); }
.observerButton,.shareButton,.tagButton { background:var(--accent-soft); color:var(--accent); border-color:#bfdbfe; }
.tagButton { border-radius:999px; padding:9px 14px; }
.tagButton.active { background:var(--accent); color:#fff; border-color:var(--accent); }
.dangerButton { background:#fff1f2; color:var(--danger); border-color:#ffe4e6; }
.full { width:100%; }
.createForm { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.wide { grid-column:1 / -1; }
.buttonRow,.searchRow,.smallButtonRow,.tagArea { display:flex; gap:10px; flex-wrap:wrap; }
.searchRow input,.homeSearch input { flex:1; }
.listHeader,.sessionTop,.participant,.friendCard,.friendIdBox,.calendarHeader,.calendarSessionItem,.cardHeader { display:flex; justify-content:space-between; gap:14px; align-items:center; }
.listHeader p,.settingText,.meta { margin:6px 0; color:var(--subtext); font-weight:700; }
.countBox { background:var(--accent-soft); color:var(--accent); border:1px solid #bfdbfe; border-radius:999px; padding:10px 16px; font-weight:900; white-space:nowrap; }
.dateHero { display:inline-flex; margin:0 0 10px; padding:10px 16px; border-radius:999px; background:var(--accent); color:#fff; font-size:20px; font-weight:950; }
.gdInfoGrid { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin:14px 0; }
.gdInfoGrid div { background:#f8fafc; border:1px solid var(--border); border-radius:16px; padding:12px; display:flex; flex-direction:column; gap:4px; }
.gdInfoGrid span { color:var(--subtext); font-size:13px; font-weight:900; }
.gdInfoGrid strong { color:var(--text); font-weight:900; }
.badgeArea { display:flex; flex-wrap:wrap; gap:8px; }
.badge { display:inline-flex; align-items:center; justify-content:center; min-height:28px; padding:6px 10px; border-radius:999px; background:#f8fafc; border:1px solid var(--border); color:var(--text); font-size:13px; font-weight:900; }
.badge.green { background:var(--success-bg); color:var(--success-text); border-color:#bbf7d0; }
.badge.yellow { background:var(--warn-bg); color:var(--warn-text); border-color:#fed7aa; }
.badge.blue { background:var(--accent-soft); color:var(--accent); border-color:#bfdbfe; }
.meta a { color:var(--accent); font-weight:900; text-decoration:none; }
.memo,.emptyText,.friendCard,.friendIdBox,.participant,.calendarSessionItem { background:#fbfdff; border:1px solid var(--border); border-radius:16px; padding:14px; }
.lockedText { background:var(--warn-bg); color:var(--warn-text); border:1px solid #fed7aa; border-radius:16px; padding:14px; font-weight:800; }
.actions { min-width:170px; display:flex; flex-direction:column; gap:10px; }
.ownerOnlyText { margin:0; color:var(--subtext); font-size:13px; font-weight:800; text-align:center; }
.settingSection { padding-top:16px; margin-top:16px; border-top:1px solid var(--border); }
.notificationBox { border-radius:16px; padding:16px; line-height:1.7; border:1px solid transparent; }
.notificationBox.ok { background:var(--success-bg); color:var(--success-text); border-color:#bbf7d0; }
.steps { margin:0; padding-left:22px; color:var(--subtext); line-height:1.9; font-weight:700; }
.searchPanel,.calendarCard { display:flex; flex-direction:column; gap:16px; }
.calendarCard { margin-top:18px; }
.calendarHeader h2 { margin:0; text-align:center; }
.calendarWeekdays,.calendarGrid { display:grid; grid-template-columns:repeat(7,1fr); gap:8px; }
.calendarWeekdays { color:var(--subtext); font-weight:900; text-align:center; }
.calendarBlank,.calendarDay { min-height:64px; border-radius:16px; }
.calendarBlank { background:transparent; }
.calendarDay { border:1px solid var(--border); background:#fbfdff; color:var(--text); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; }
.calendarDay.hasSession { background:var(--accent-soft); border-color:#bfdbfe; color:var(--accent); }
.calendarDay.selected { background:var(--accent); border-color:var(--accent); color:#fff; }
.calendarDay small { font-weight:900; font-size:12px; }
.calendarResult { margin-top:8px; display:flex; flex-direction:column; gap:10px; }
.homeLogoutArea { margin-top:18px; display:flex; justify-content:center; }
.empty { text-align:center; color:var(--subtext); font-weight:800; }
@media (max-width:860px) { .app { padding:14px; } .hero,.homeMenu,.summaryGrid,.sessionTop,.createForm,.listHeader,.buttonRow,.searchRow,.smallButtonRow,.friendIdBox,.friendCard,.participant,.calendarHeader,.calendarSessionItem,.homeSearch { display:flex; flex-direction:column; align-items:stretch; } .appTitle { font-size:32px; } .actions { width:100%; } .countBox { width:fit-content; } .gdInfoGrid { grid-template-columns:1fr; } .calendarWeekdays,.calendarGrid { gap:5px; } .calendarBlank,.calendarDay { min-height:52px; border-radius:12px; } }
`;
