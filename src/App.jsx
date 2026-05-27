import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const EVENT_TYPES = ["GD練習会", "ES添削会", "模擬面接会"];

const ADMIN_EMAILS = ["kou.hig.may.5@gmail.com"];

function createFriendCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i++) {
    const index = Math.floor(Math.random() * chars.length);
    code += chars[index];
  }

  return code;
}

function formatDateTime(session) {
  if (!session.monthDay && !session.time) return "日時未設定";
  return `${session.monthDay || ""} ${session.time || ""}`.trim();
}

function getSessionDate(session) {
  const monthDayMatch = String(session.monthDay || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  const timeMatch = String(session.time || "").match(/^(\d{1,2}):(\d{2})$/);

  if (!monthDayMatch || !timeMatch) return null;

  const now = new Date();
  const year = now.getFullYear();
  const month = Number(monthDayMatch[1]) - 1;
  const day = Number(monthDayMatch[2]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  const date = new Date(year, month, day, hour, minute, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDeleteDate(session) {
  const sessionDate = getSessionDate(session);
  if (!sessionDate) return null;

  const deleteDate = new Date(sessionDate);
  deleteDate.setHours(deleteDate.getHours() + 10);
  return deleteDate;
}

function isExpiredSession(session) {
  const deleteDate = getDeleteDate(session);
  if (!deleteDate) return false;
  return new Date() >= deleteDate;
}

function formatDeleteDate(session) {
  const deleteDate = getDeleteDate(session);

  if (!deleteDate) return "削除予定：日時未設定";

  const month = deleteDate.getMonth() + 1;
  const day = deleteDate.getDate();
  const hour = String(deleteDate.getHours()).padStart(2, "0");
  const minute = String(deleteDate.getMinutes()).padStart(2, "0");

  return `削除予定：${month}/${day} ${hour}:${minute}`;
}

function getNotificationStatus() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  return Notification.permission;
}

function fromSupabase(row) {
  return {
    id: row.id,
    type: row.type || "GD練習会",
    title: row.title,
    theme: row.theme,
    monthDay: row.month_day,
    time: row.time,
    maxParticipants: row.max_participants,
    maxObservers: row.max_observers || 1,
    zoomUrl: row.zoom_url || "",
    memo: row.memo || "",
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    ownerUserId: row.owner_user_id,
    visibility: row.visibility || "public",
    participants: Array.isArray(row.participants) ? row.participants : [],
    observers: Array.isArray(row.observers) ? row.observers : [],
    createdAt: row.created_at,
  };
}

function toSupabase(session) {
  return {
    type: session.type,
    title: session.title,
    theme: session.theme,
    month_day: session.monthDay,
    time: session.time,
    max_participants: Number(session.maxParticipants) || 6,
    max_observers: 1,
    zoom_url: session.zoomUrl || "",
    memo: session.memo || "",
    participants: session.participants || [],
    observers: session.observers || [],
    created_by: session.createdBy,
    created_by_name: session.createdByName,
    owner_user_id: session.ownerUserId,
    visibility: session.visibility || "public",
  };
}

function buildShareText(session) {
  const appUrl = window.location.origin;

  return [
    "【就活練習会の募集】",
    `種類：${session.type}`,
    `タイトル：${session.title}`,
    `日時：${formatDateTime(session)}`,
    `内容：${session.theme}`,
    `公開範囲：${session.visibility === "friends" ? "フレンド限定" : "全員公開"}`,
    `募集人数：${session.participants.length}/${session.maxParticipants}人`,
    `オブザーバー：${session.observers.length}/${session.maxObservers}人`,
    "",
    `参加はこちら：${appUrl}`,
  ].join("\n");
}

async function shareSession(session) {
  const text = buildShareText(session);
  const appUrl = window.location.origin;

  const shareData = {
    title: session.title,
    text,
    url: appUrl,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    await navigator.clipboard.writeText(`${text}\n${appUrl}`);
    alert("募集リンクをコピーしました。好きなアプリに貼り付けて共有できます。");
  } catch (error) {
    console.error(error);
  }
}

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    email: "",
    password: "",
  });

  const [currentPage, setCurrentPage] = useState("home");
  const [sessions, setSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [dbError, setDbError] = useState("");

  const [profile, setProfile] = useState(null);
  const [profileDraft, setProfileDraft] = useState({
    name: "",
    hasZoomLicense: false,
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const [allProfiles, setAllProfiles] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [foundProfile, setFoundProfile] = useState(null);
  const [friendMessage, setFriendMessage] = useState("");

  const [notificationStatus, setNotificationStatus] = useState(getNotificationStatus);

  const [newSession, setNewSession] = useState({
    type: "GD練習会",
    title: "",
    theme: "",
    monthDay: "",
    time: "",
    maxParticipants: 6,
    visibility: "public",
    zoomUrl: "",
    memo: "",
  });

  const [searchKeyword, setSearchKeyword] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setAuthUser(data.session?.user || null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user || null);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUser) return;

    initializeUser();
    loadEverything();

    const timer = setInterval(() => {
      loadEverything();
    }, 60 * 1000);

    const channel = supabase
      .channel("app_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "gd_sessions",
        },
        () => loadSessions()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
        },
        () => loadFriendRequests()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_profiles",
        },
        () => loadProfiles()
      )
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
      .filter((request) => request.status === "accepted")
      .forEach((request) => {
        if (request.from_user_id === authUser.id) ids.add(request.to_user_id);
        if (request.to_user_id === authUser.id) ids.add(request.from_user_id);
      });

    return ids;
  }, [friendRequests, authUser]);

  const friends = useMemo(() => {
    return allProfiles.filter((person) => friendIds.has(person.id));
  }, [allProfiles, friendIds]);

  const incomingRequests = useMemo(() => {
    if (!authUser) return [];

    return friendRequests.filter(
      (request) => request.to_user_id === authUser.id && request.status === "pending"
    );
  }, [friendRequests, authUser]);

  const outgoingRequests = useMemo(() => {
    if (!authUser) return [];

    return friendRequests.filter(
      (request) => request.from_user_id === authUser.id && request.status === "pending"
    );
  }, [friendRequests, authUser]);

  const sortedSessions = useMemo(() => {
    if (!authUser) return sessions;

    function getPriority(session) {
      const friendParticipates = [...session.participants, ...session.observers].some(
        (person) => friendIds.has(person.id)
      );

      const friendCreated = friendIds.has(session.ownerUserId);
      const mySession = session.ownerUserId === authUser.id;

      if (mySession) return 4;
      if (friendParticipates) return 3;
      if (friendCreated) return 2;
      return 1;
    }

    return [...sessions].sort((a, b) => {
      const priorityDiff = getPriority(b) - getPriority(a);

      if (priorityDiff !== 0) return priorityDiff;

      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }, [sessions, friendIds, authUser]);

  function isAdminUser() {
    return ADMIN_EMAILS.includes(authUser?.email || "");
  }

  const filteredSessions = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();

    return sortedSessions.filter((session) => {
      const searchTarget = [
        session.type,
        session.title,
        session.theme,
        session.createdByName,
        session.monthDay,
        session.time,
        session.memo,
      ]
        .join(" ")
        .toLowerCase();

      const matchesKeyword = !keyword || searchTarget.includes(keyword);

      const allMembers = [...session.participants, ...session.observers];
      const friendInRoom = allMembers.some((person) => friendIds.has(person.id));
      const friendCreated = friendIds.has(session.ownerUserId);
      const hasJoined = allMembers.some((person) => person.id === authUser.id);

      let matchesTag = true;

      if (selectedTag === "gd") matchesTag = session.type === "GD練習会";
      if (selectedTag === "es") matchesTag = session.type === "ES添削会";
      if (selectedTag === "interview") matchesTag = session.type === "模擬面接会";
      if (selectedTag === "public") matchesTag = session.visibility !== "friends";
      if (selectedTag === "friends") matchesTag = session.visibility === "friends";
      if (selectedTag === "friendRelated") matchesTag = friendCreated || friendInRoom;
      if (selectedTag === "joined") matchesTag = hasJoined;
      if (selectedTag === "available") {
        matchesTag = session.participants.length < session.maxParticipants;
      }

      return matchesKeyword && matchesTag;
    });
  }, [sortedSessions, searchKeyword, selectedTag, friendIds, authUser]);

  async function signUp() {
    if (!authForm.email.trim() || !authForm.password.trim()) {
      alert("メールアドレスとパスワードを入力してください");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: authForm.email.trim(),
      password: authForm.password,
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert("登録できました。ログイン画面に切り替えてログインしてください。");
    setAuthMode("login");
  }

  async function signIn() {
    if (!authForm.email.trim() || !authForm.password.trim()) {
      alert("メールアドレスとパスワードを入力してください");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: authForm.email.trim(),
      password: authForm.password,
    });

    if (error) {
      alert(error.message);
    }
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

    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();

    if (error) {
      console.error(error);
      return;
    }

    if (data) {
      if (!data.friend_code) {
        const newCode = createFriendCode();

        const { data: updatedProfile, error: updateError } = await supabase
          .from("user_profiles")
          .update({
            friend_code: newCode,
            updated_at: new Date().toISOString(),
          })
          .eq("id", authUser.id)
          .select()
          .single();

        if (updateError) {
          console.error(updateError);
          return;
        }

        setProfile(updatedProfile);
        setProfileDraft({
          name: updatedProfile.name,
          hasZoomLicense: updatedProfile.has_zoom_license,
        });
        setIsEditingProfile(updatedProfile.name === "未設定");
        await loadProfiles();
        return;
      }

      setProfile(data);
      setProfileDraft({
        name: data.name,
        hasZoomLicense: data.has_zoom_license,
      });
      setIsEditingProfile(data.name === "未設定");
      return;
    }

    let insertedProfile = null;
    let insertError = null;

    for (let i = 0; i < 5; i++) {
      const newProfile = {
        id: authUser.id,
        friend_code: createFriendCode(),
        name: "未設定",
        has_zoom_license: false,
      };

      const result = await supabase
        .from("user_profiles")
        .insert(newProfile)
        .select()
        .single();

      insertedProfile = result.data;
      insertError = result.error;

      if (!insertError) break;

      console.error(insertError);
    }

    if (insertError) {
      alert("プロフィール作成に失敗しました。少し時間を置いて再読み込みしてください。");
      return;
    }

    setProfile(insertedProfile);
    setProfileDraft({
      name: insertedProfile.name,
      hasZoomLicense: insertedProfile.has_zoom_license,
    });
    setIsEditingProfile(true);
    await loadProfiles();
  }

  async function loadEverything() {
    await Promise.all([loadProfiles(), loadFriendRequests(), loadSessions()]);
  }

  async function loadProfiles() {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    setAllProfiles(data || []);
  }

  async function loadFriendRequests() {
    if (!authUser) return;

    const { data, error } = await supabase
      .from("friend_requests")
      .select("*")
      .or(`from_user_id.eq.${authUser.id},to_user_id.eq.${authUser.id}`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    setFriendRequests(data || []);
  }

  async function deleteExpiredSessions(targetSessions) {
    const expiredSessions = targetSessions.filter(isExpiredSession);

    if (expiredSessions.length === 0) return targetSessions;

    const expiredIds = expiredSessions.map((session) => session.id);

    const { error } = await supabase.from("gd_sessions").delete().in("id", expiredIds);

    if (error) {
      console.error(error);
      return targetSessions;
    }

    return targetSessions.filter((session) => !expiredIds.includes(session.id));
  }

  async function loadSessions() {
    setIsLoadingSessions(true);
    setDbError("");

    const { data, error } = await supabase
      .from("gd_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setDbError("募集データの読み込みに失敗しました。");
      setIsLoadingSessions(false);
      return;
    }

    const loadedSessions = (data || []).map(fromSupabase);
    const activeSessions = await deleteExpiredSessions(loadedSessions);

    setSessions(activeSessions);
    setIsLoadingSessions(false);
  }

  async function saveProfile() {
    if (!profileDraft.name.trim()) {
      alert("名前を入力してください");
      return;
    }

    const { data, error } = await supabase
      .from("user_profiles")
      .update({
        name: profileDraft.name.trim(),
        has_zoom_license: profileDraft.hasZoomLicense,
        updated_at: new Date().toISOString(),
      })
      .eq("id", authUser.id)
      .select()
      .single();

    if (error) {
      console.error(error);
      alert("プロフィール保存に失敗しました");
      return;
    }

    setProfile(data);
    setProfileDraft({
      name: data.name,
      hasZoomLicense: data.has_zoom_license,
    });
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
    if (!("Notification" in window)) {
      setNotificationStatus("unsupported");
      alert("このブラウザは通知に対応していません");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationStatus(permission);

    if (permission === "granted") {
      sendBrowserNotification("通知がオンになりました", "募集人数に達したときに通知します。");
    }
  }

  function sendBrowserNotification(title, body) {
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  }

  async function createSession(event) {
    event.preventDefault();

    if (!requireProfile()) return;

    if (
      !newSession.title.trim() ||
      !newSession.theme.trim() ||
      !newSession.monthDay.trim() ||
      !newSession.time
    ) {
      alert("種類、タイトル、内容、日付、時間を入力してください");
      return;
    }

    const session = {
      type: newSession.type,
      title: newSession.title.trim(),
      theme: newSession.theme.trim(),
      monthDay: newSession.monthDay.trim(),
      time: newSession.time,
      maxParticipants: Number(newSession.maxParticipants) || 6,
      maxObservers: 1,
      visibility: newSession.visibility,
      zoomUrl: newSession.zoomUrl.trim(),
      memo: newSession.memo.trim(),
      createdBy: authUser.id,
      createdByName: profile.name,
      ownerUserId: authUser.id,
      participants: [],
      observers: [],
    };

    const { data, error } = await supabase
      .from("gd_sessions")
      .insert(toSupabase(session))
      .select()
      .single();

    if (error) {
      console.error(error);
      alert("募集の作成に失敗しました");
      return;
    }

    setSessions((current) => [fromSupabase(data), ...current]);

    setNewSession({
      type: "GD練習会",
      title: "",
      theme: "",
      monthDay: "",
      time: "",
      maxParticipants: 6,
      visibility: "public",
      zoomUrl: "",
      memo: "",
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

    const target = sessions.find((session) => session.id === sessionId);
    if (!target) return;

    if (!canJoinSession(target)) {
      alert("この部屋はフレンド限定です。部屋を作成した人のフレンドだけ参加できます。");
      return;
    }

    const alreadyParticipant = target.participants.some((person) => person.id === authUser.id);
    const alreadyObserver = target.observers.some((person) => person.id === authUser.id);

    if (alreadyParticipant || alreadyObserver) {
      alert("すでにこの募集に参加しています");
      return;
    }

    const profileData = {
      id: authUser.id,
      name: profile.name,
      hasZoomLicense: profile.has_zoom_license,
    };

    let nextParticipants = [...target.participants];
    let nextObservers = [...target.observers];

    if (joinType === "observer") {
      if (nextObservers.length >= target.maxObservers) {
        alert("オブザーバー枠は埋まっています");
        return;
      }

      nextObservers.push(profileData);
    } else {
      if (nextParticipants.length >= target.maxParticipants) {
        alert("募集人数に達しています");
        return;
      }

      nextParticipants.push(profileData);
    }

    const isNowFull = nextParticipants.length >= target.maxParticipants;

    const { data, error } = await supabase
      .from("gd_sessions")
      .update({
        participants: nextParticipants,
        observers: nextObservers,
      })
      .eq("id", sessionId)
      .select()
      .single();

    if (error) {
      console.error(error);
      alert("参加に失敗しました");
      return;
    }

    setSessions((current) =>
      current.map((session) => (session.id === sessionId ? fromSupabase(data) : session))
    );

    if (isNowFull) {
      sendBrowserNotification("募集人数に達しました", `「${target.title}」の参加者が集まりました。`);
    }

    await loadSessions();
  }

  async function leaveSession(sessionId) {
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) return;

    const nextParticipants = target.participants.filter((person) => person.id !== authUser.id);
    const nextObservers = target.observers.filter((person) => person.id !== authUser.id);

    const { data, error } = await supabase
      .from("gd_sessions")
      .update({
        participants: nextParticipants,
        observers: nextObservers,
      })
      .eq("id", sessionId)
      .select()
      .single();

    if (error) {
      console.error(error);
      alert("参加取り消しに失敗しました");
      return;
    }

    setSessions((current) =>
      current.map((session) => (session.id === sessionId ? fromSupabase(data) : session))
    );

    await loadSessions();
  }

  async function deleteSession(sessionId) {
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) return;

    if (target.ownerUserId !== authUser.id && !isAdminUser()) {
      alert("募集を削除できるのは作成者または管理者のみです");
      return;
    }

    const ok = confirm("この募集を削除しますか？");
    if (!ok) return;

    const { error } = await supabase.from("gd_sessions").delete().eq("id", sessionId);

    if (error) {
      console.error(error);
      alert("削除に失敗しました");
      return;
    }

    setSessions((current) => current.filter((session) => session.id !== sessionId));
    await loadSessions();
  }

  async function resetAllSessions() {
    const ok = confirm("自分が作成した募集をすべて削除しますか？");
    if (!ok) return;

    const { error } = await supabase
      .from("gd_sessions")
      .delete()
      .eq("owner_user_id", authUser.id);

    if (error) {
      console.error(error);
      alert("初期化に失敗しました");
      return;
    }

    await loadSessions();
  }

  async function searchFriendByCode() {
    setFriendMessage("");
    setFoundProfile(null);

    const code = friendCodeInput.trim().toUpperCase();

    if (!code) {
      alert("フレンドIDを入力してください");
      return;
    }

    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("friend_code", code)
      .maybeSingle();

    if (error) {
      console.error(error);
      setFriendMessage("検索に失敗しました。");
      return;
    }

    if (!data) {
      setFriendMessage("該当するユーザーが見つかりませんでした。");
      return;
    }

    if (data.id === authUser.id) {
      setFriendMessage("自分自身にはフレンド申請できません。");
      return;
    }

    setFoundProfile(data);
  }

  async function sendFriendRequest(targetProfile) {
    const existing = friendRequests.find(
      (request) =>
        (request.from_user_id === authUser.id && request.to_user_id === targetProfile.id) ||
        (request.from_user_id === targetProfile.id && request.to_user_id === authUser.id)
    );

    if (existing) {
      if (existing.status === "accepted") {
        alert("すでにフレンドです");
      } else {
        alert("すでに申請中です");
      }
      return;
    }

    const { error } = await supabase.from("friend_requests").insert({
      from_user_id: authUser.id,
      to_user_id: targetProfile.id,
      status: "pending",
    });

    if (error) {
      console.error(error);
      alert("フレンド申請に失敗しました");
      return;
    }

    setFoundProfile(null);
    setFriendCodeInput("");
    setFriendMessage("フレンド申請を送りました。");
    await loadFriendRequests();
  }

  async function acceptFriendRequest(requestId) {
    const { error } = await supabase
      .from("friend_requests")
      .update({ status: "accepted" })
      .eq("id", requestId);

    if (error) {
      console.error(error);
      alert("承認に失敗しました");
      return;
    }

    await loadFriendRequests();
  }

  async function deleteFriendRequest(requestId) {
    const { error } = await supabase.from("friend_requests").delete().eq("id", requestId);

    if (error) {
      console.error(error);
      alert("削除に失敗しました");
      return;
    }

    await loadFriendRequests();
  }

  function getProfileName(userId) {
    const target = allProfiles.find((person) => person.id === userId);
    return target?.name || "不明";
  }

  if (!supabase) {
    return (
      <div className="app">
        <style>{styles}</style>
        <div className="authCard">
          <h1>GD Practice Hub</h1>
          <p>Supabaseの環境変数が設定されていません。</p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="app">
        <style>{styles}</style>

        <main className="authLayout">
          <div className="authCard">
            <p className="label">大学生向け就活練習アプリ</p>
            <h1>GD Practice Hub</h1>
            <p className="description">
              ログインすると、募集・参加・フレンド機能が使えます。
            </p>

            <div className="authTabs">
              <button
                className={authMode === "login" ? "choice active" : "choice"}
                onClick={() => setAuthMode("login")}
              >
                ログイン
              </button>
              <button
                className={authMode === "signup" ? "choice active" : "choice"}
                onClick={() => setAuthMode("signup")}
              >
                新規登録
              </button>
            </div>

            <div className="formArea">
              <label>
                メールアドレス
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) =>
                    setAuthForm({ ...authForm, email: event.target.value })
                  }
                  placeholder="example@email.com"
                />
              </label>

              <label>
                パスワード
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm({ ...authForm, password: event.target.value })
                  }
                  placeholder="6文字以上"
                />
              </label>

              {authMode === "login" ? (
                <button className="mainButton full" onClick={signIn}>
                  ログイン
                </button>
              ) : (
                <button className="mainButton full" onClick={signUp}>
                  新規登録
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <style>{styles}</style>

      <header className="hero">
        <div className="heroContent">
          <p className="label">大学生向け就活練習アプリ</p>
          <h1>GD Practice Hub</h1>
          <p className="description">
            GD練習会・ES添削会・模擬面接会を募集できます。
            フレンドがいる部屋は優先表示され、フレンド限定部屋も作成できます。
          </p>
        </div>

        <div className="heroActions">
          {currentPage !== "home" && (
            <button className="subButton" onClick={() => setCurrentPage("home")}>
              ホームへ戻る
            </button>
          )}

          <button className="dangerButton" onClick={signOut}>
            ログアウト
          </button>
        </div>
      </header>

      {dbError && <div className="alert">{dbError}</div>}

      {currentPage === "home" && (
        <main className="homeLayout">
          <section className="homeCard">
            <h2>ホーム</h2>
            <p>
              必要な操作を選んでください。フレンド・プロフィール・通知設定は必要なときだけ開けます。
            </p>

            <div className="homeMenu">
              <button className="homeButton primary" onClick={() => setCurrentPage("create")}>
                <span>部屋を作成</span>
                <small>GD・ES添削・模擬面接の募集を作る</small>
              </button>

              <button className="homeButton" onClick={() => setCurrentPage("rooms")}>
                <span>部屋を検索</span>
                <small>フレンドがいる部屋を優先表示</small>
              </button>

              <button className="homeButton" onClick={() => setCurrentPage("friends")}>
                <span>フレンド</span>
                <small>ID検索・申請・承認</small>
              </button>

              <button className="homeButton" onClick={() => setCurrentPage("profile")}>
                <span>プロフィール</span>
                <small>名前とZoomライセンスを設定</small>
              </button>

              <button className="homeButton" onClick={() => setCurrentPage("settings")}>
                <span>その他設定</span>
                <small>通知設定や募集初期化</small>
              </button>

              <button className="homeButton" onClick={() => setCurrentPage("help")}>
                <span>使い方について</span>
                <small>アプリの使い方を確認</small>
              </button>
            </div>
          </section>

          <section className="summaryGrid">
            <div className="miniCard">
              <strong>{sessions.length}</strong>
              <span>募集中の部屋</span>
            </div>

            <div className="miniCard">
              <strong>{friends.length}</strong>
              <span>フレンド</span>
            </div>

            <div className="miniCard">
              <strong>{profile?.name === "未設定" ? "未登録" : "登録済み"}</strong>
              <span>プロフィール</span>
            </div>
          </section>
        </main>
      )}

      {currentPage === "create" && (
        <main className="singleLayout">
          <div className="card">
            <h2>部屋を作成</h2>

            <form className="createForm" onSubmit={createSession}>
              <label>
                募集の種類
                <select
                  value={newSession.type}
                  onChange={(event) =>
                    setNewSession({ ...newSession, type: event.target.value })
                  }
                >
                  {EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                公開範囲
                <select
                  value={newSession.visibility}
                  onChange={(event) =>
                    setNewSession({ ...newSession, visibility: event.target.value })
                  }
                >
                  <option value="public">全員に公開</option>
                  <option value="friends">フレンド限定</option>
                </select>
              </label>

              <label>
                募集人数
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={newSession.maxParticipants}
                  onChange={(event) =>
                    setNewSession({ ...newSession, maxParticipants: event.target.value })
                  }
                />
              </label>

              <label>
                日付
                <input
                  type="text"
                  value={newSession.monthDay}
                  onChange={(event) =>
                    setNewSession({ ...newSession, monthDay: event.target.value })
                  }
                  placeholder="例：6/1"
                />
              </label>

              <label>
                時間
                <input
                  type="time"
                  value={newSession.time}
                  onChange={(event) =>
                    setNewSession({ ...newSession, time: event.target.value })
                  }
                />
              </label>

              <label className="wide">
                タイトル
                <input
                  value={newSession.title}
                  onChange={(event) =>
                    setNewSession({ ...newSession, title: event.target.value })
                  }
                  placeholder="例：IT業界志望向けGD練習"
                />
              </label>

              <label className="wide">
                内容・テーマ
                <input
                  value={newSession.theme}
                  onChange={(event) =>
                    setNewSession({ ...newSession, theme: event.target.value })
                  }
                  placeholder="例：大学生向けの新サービスを考えよ"
                />
              </label>

              <label className="wide">
                Zoomリンク
                <input
                  value={newSession.zoomUrl}
                  onChange={(event) =>
                    setNewSession({ ...newSession, zoomUrl: event.target.value })
                  }
                  placeholder="後で入力でもOK"
                />
              </label>

              <label className="wide">
                備考
                <textarea
                  value={newSession.memo}
                  onChange={(event) =>
                    setNewSession({ ...newSession, memo: event.target.value })
                  }
                  placeholder="例：初心者歓迎、カメラON推奨など"
                />
              </label>

              <div className="observerNote wide">
                オブザーバー希望枠は1名までです。フレンド限定の場合、部屋主のフレンドだけ参加できます。
              </div>

              <div className="buttonRow wide">
                <button className="mainButton" type="submit">
                  作成する
                </button>

                <button className="subButton" type="button" onClick={() => setCurrentPage("home")}>
                  キャンセル
                </button>
              </div>
            </form>
          </div>
        </main>
      )}

      {currentPage === "rooms" && (
        <main className="singleLayout">
          <div className="card listHeader">
            <div>
              <h2>部屋を検索</h2>
              <p>フレンドが作成・参加している部屋が優先的に表示されます。</p>
            </div>

            <div className="countBox">
              {isLoadingSessions
                ? "読み込み中"
                : `${filteredSessions.length}/${sessions.length}件表示`}
            </div>
          </div>

          <div className="card searchPanel">
            <label>
              キーワード検索
              <input
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                placeholder="タイトル・内容・作成者・日付などで検索"
              />
            </label>

            <div className="tagArea">
              {[
                ["all", "すべて"],
                ["gd", "GD"],
                ["es", "ES添削"],
                ["interview", "模擬面接"],
                ["available", "空きあり"],
                ["public", "全員公開"],
                ["friends", "フレンド限定"],
                ["friendRelated", "フレンド関連"],
                ["joined", "参加中"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={selectedTag === value ? "tagButton active" : "tagButton"}
                  onClick={() => setSelectedTag(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="sessionList">
            {filteredSessions.length === 0 ? (
              <div className="card empty">募集は現在ありません。</div>
            ) : (
              filteredSessions.map((session) => {
                const isOwner = session.ownerUserId === authUser.id;
                const isFriendLimited = session.visibility === "friends";
                const canJoin = canJoinSession(session);

                const hasJoinedAsParticipant = session.participants.some(
                  (person) => person.id === authUser.id
                );

                const hasJoinedAsObserver = session.observers.some(
                  (person) => person.id === authUser.id
                );

                const hasJoined = hasJoinedAsParticipant || hasJoinedAsObserver;
                const isFull = session.participants.length >= session.maxParticipants;
                const isObserverFull = session.observers.length >= session.maxObservers;

                const allMembers = [...session.participants, ...session.observers];
                const zoomHosts = allMembers.filter((person) => person.hasZoomLicense);
                const hasZoomHost = zoomHosts.length > 0;

                const friendInRoom = allMembers.some((person) => friendIds.has(person.id));
                const friendCreated = friendIds.has(session.ownerUserId);

                return (
                  <div className="card sessionCard" key={session.id}>
                    <div className="sessionTop">
                      <div>
                        <div className="badgeArea">
                          <span className="badge blue">{session.type}</span>

                          <span className={isFriendLimited ? "badge yellow" : "badge blue"}>
                            {isFriendLimited ? "フレンド限定" : "全員公開"}
                          </span>

                          {friendCreated && <span className="badge green">フレンド作成</span>}
                          {friendInRoom && <span className="badge green">フレンド参加中</span>}

                          <span className={hasZoomHost ? "badge green" : "badge yellow"}>
                            {hasZoomHost ? "Zoomホスト候補あり" : "Zoomホスト候補なし"}
                          </span>

                          <span className={isFull ? "badge green" : "badge"}>
                            参加者 {session.participants.length}/{session.maxParticipants}人
                          </span>

                          <span className={isObserverFull ? "badge green" : "badge blue"}>
                            オブザーバー {session.observers.length}/{session.maxObservers}人
                          </span>
                        </div>

                        <h3>{session.title}</h3>
                        <p className="theme">{session.theme}</p>
                        <p className="meta">作成者：{session.createdByName}</p>
                        <p className="meta">日時：{formatDateTime(session)}</p>
                        <p className="meta">{formatDeleteDate(session)}</p>

                        {session.zoomUrl ? (
                          <p className="meta">
                            Zoomリンク：
                            <a href={session.zoomUrl} target="_blank" rel="noreferrer">
                              開く
                            </a>
                          </p>
                        ) : (
                          <p className="meta">Zoomリンク：未設定</p>
                        )}

                        {session.memo && <p className="memo">{session.memo}</p>}

                        {!canJoin && (
                          <p className="lockedText">
                            この部屋はフレンド限定です。部屋主のフレンドのみ参加できます。
                          </p>
                        )}
                      </div>

                      <div className="actions">
                        {hasJoined ? (
                          <button className="subButton" onClick={() => leaveSession(session.id)}>
                            参加を取り消す
                          </button>
                        ) : (
                          <>
                            <button
                              className="mainButton"
                              disabled={isFull || !canJoin}
                              onClick={() => joinSession(session.id, "participant")}
                            >
                              {isFull ? "満員" : "参加する"}
                            </button>

                            <button
                              className="observerButton"
                              disabled={isObserverFull || !canJoin}
                              onClick={() => joinSession(session.id, "observer")}
                            >
                              {isObserverFull ? "オブザーバー満員" : "オブザーバー希望"}
                            </button>
                          </>
                        )}

                        <button className="shareButton" onClick={() => shareSession(session)}>
                          共有
                        </button>

                        {(isOwner || isAdminUser()) ? (
                          <button className="dangerButton" onClick={() => deleteSession(session.id)}>
                            削除
                          </button>
                        ) : (
                          <p className="ownerOnlyText">削除は作成者または管理者のみ</p>
                        )}
                      </div>
                    </div>

                    <div className="bottomArea">
                      <div>
                        <h4>参加者一覧</h4>

                        {session.participants.length === 0 ? (
                          <p className="emptyText">まだ参加者はいません。</p>
                        ) : (
                          <div className="participants">
                            {session.participants.map((person) => (
                              <div className="participant" key={person.id}>
                                <strong>{person.name}</strong>
                                <span className={person.hasZoomLicense ? "badge green" : "badge"}>
                                  {person.hasZoomLicense ? "Zoomライセンスあり" : "Zoomライセンスなし"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <h4>オブザーバー</h4>

                        {session.observers.length === 0 ? (
                          <p className="emptyText">まだオブザーバーはいません。</p>
                        ) : (
                          <div className="participants">
                            {session.observers.map((person) => (
                              <div className="participant" key={person.id}>
                                <strong>{person.name}</strong>
                                <span className={person.hasZoomLicense ? "badge green" : "badge"}>
                                  {person.hasZoomLicense ? "Zoomライセンスあり" : "Zoomライセンスなし"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="zoomArea">
                      <h4>Zoomホスト確認</h4>

                      {hasZoomHost ? (
                        <div className="zoomBox ok">
                          <strong>Zoomを開ける人がいます。</strong>
                          <p>ホスト候補：{zoomHosts.map((person) => person.name).join("、")}</p>
                        </div>
                      ) : (
                        <div className="zoomBox warning">
                          <strong>Zoomライセンス保持者が必要です。</strong>
                          <p>
                            Zoomで実施するため、参加者またはオブザーバーの中にZoomライセンスを持つ人が1人以上必要です。
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>
      )}

      {currentPage === "friends" && (
        <main className="singleLayout">
          <div className="card">
            <h2>フレンド</h2>

            <div className="friendIdBox">
              <span>あなたのフレンドID</span>
              <strong>{profile?.friend_code || "作成中..."}</strong>
              <button
                className="subButton"
                disabled={!profile?.friend_code}
                onClick={() => navigator.clipboard.writeText(profile?.friend_code || "")}
              >
                IDをコピー
              </button>
            </div>

            <div className="settingSection">
              <h3>IDで検索</h3>

              <div className="searchRow">
                <input
                  value={friendCodeInput}
                  onChange={(event) => setFriendCodeInput(event.target.value.toUpperCase())}
                  placeholder="例：ABC234"
                />
                <button className="mainButton" onClick={searchFriendByCode}>
                  検索
                </button>
              </div>

              {friendMessage && <p className="settingText">{friendMessage}</p>}

              {foundProfile && (
                <div className="friendCard">
                  <strong>{foundProfile.name}</strong>
                  <span>ID：{foundProfile.friend_code}</span>
                  <button className="mainButton" onClick={() => sendFriendRequest(foundProfile)}>
                    フレンド申請を送る
                  </button>
                </div>
              )}
            </div>

            <div className="settingSection">
              <h3>届いた申請</h3>

              {incomingRequests.length === 0 ? (
                <p className="emptyText">届いている申請はありません。</p>
              ) : (
                <div className="participants">
                  {incomingRequests.map((request) => (
                    <div className="participant" key={request.id}>
                      <strong>{getProfileName(request.from_user_id)}</strong>

                      <div className="smallButtonRow">
                        <button className="mainButton" onClick={() => acceptFriendRequest(request.id)}>
                          承認
                        </button>
                        <button className="dangerButton" onClick={() => deleteFriendRequest(request.id)}>
                          拒否
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="settingSection">
              <h3>申請中</h3>

              {outgoingRequests.length === 0 ? (
                <p className="emptyText">送信中の申請はありません。</p>
              ) : (
                <div className="participants">
                  {outgoingRequests.map((request) => (
                    <div className="participant" key={request.id}>
                      <strong>{getProfileName(request.to_user_id)}</strong>
                      <button className="dangerButton" onClick={() => deleteFriendRequest(request.id)}>
                        取り消す
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="settingSection">
              <h3>フレンド一覧</h3>

              {friends.length === 0 ? (
                <p className="emptyText">まだフレンドはいません。</p>
              ) : (
                <div className="participants">
                  {friends.map((friend) => (
                    <div className="participant" key={friend.id}>
                      <strong>{friend.name}</strong>
                      <span className={friend.has_zoom_license ? "badge green" : "badge"}>
                        {friend.has_zoom_license ? "Zoomライセンスあり" : "Zoomライセンスなし"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      {currentPage === "profile" && (
        <main className="singleLayout">
          <div className="card">
            <div className="cardHeader">
              <h2>プロフィール</h2>

              {!isEditingProfile && (
                <button className="subButton" onClick={() => setIsEditingProfile(true)}>
                  編集
                </button>
              )}
            </div>

            {isEditingProfile ? (
              <div className="formArea">
                <label>
                  名前
                  <input
                    value={profileDraft.name}
                    onChange={(event) =>
                      setProfileDraft({ ...profileDraft, name: event.target.value })
                    }
                    placeholder="例：田中太郎"
                  />
                </label>

                <div>
                  <p className="formLabel">Zoomライセンスを持っていますか？</p>

                  <div className="choiceArea">
                    <button
                      type="button"
                      className={profileDraft.hasZoomLicense ? "choice active" : "choice"}
                      onClick={() =>
                        setProfileDraft({ ...profileDraft, hasZoomLicense: true })
                      }
                    >
                      持っている
                    </button>

                    <button
                      type="button"
                      className={!profileDraft.hasZoomLicense ? "choice active" : "choice"}
                      onClick={() =>
                        setProfileDraft({ ...profileDraft, hasZoomLicense: false })
                      }
                    >
                      持っていない
                    </button>
                  </div>
                </div>

                <button className="mainButton full" onClick={saveProfile}>
                  保存する
                </button>
              </div>
            ) : (
              <div className="profileBox">
                <p>
                  <span>名前：</span>
                  <strong>{profile?.name}</strong>
                </p>

                <p>
                  <span>フレンドID：</span>
                  <strong>{profile?.friend_code || "作成中..."}</strong>
                </p>

                <p>
                  <span>Zoom：</span>
                  <strong>
                    {profile?.has_zoom_license ? "Zoomライセンスあり" : "Zoomライセンスなし"}
                  </strong>
                </p>
              </div>
            )}
          </div>
        </main>
      )}

      {currentPage === "settings" && (
        <main className="singleLayout">
          <div className="card">
            <h2>その他設定</h2>

            <div className="settingSection">
              <h3>通知設定</h3>
              <p className="settingText">募集人数に達したときに、ブラウザ通知を出します。</p>

              {notificationStatus === "unsupported" ? (
                <p className="warningText">このブラウザは通知に対応していません。</p>
              ) : notificationStatus === "granted" ? (
                <div className="notificationBox ok">
                  <strong>通知は許可されています</strong>
                  <button
                    className="subButton full"
                    onClick={() =>
                      sendBrowserNotification("テスト通知", "GD Practice Hubの通知テストです。")
                    }
                  >
                    テスト通知を送る
                  </button>
                </div>
              ) : notificationStatus === "denied" ? (
                <div className="notificationBox warning">
                  <strong>通知がブロックされています</strong>
                  <p>ブラウザの設定から通知を許可してください。</p>
                </div>
              ) : (
                <button className="mainButton full" onClick={requestNotificationPermission}>
                  通知を許可する
                </button>
              )}
            </div>

            <div className="settingSection">
              <h3>データ管理</h3>
              <p className="settingText">自分が作成した募集だけ初期化できます。</p>

              <button className="dangerButton full" onClick={resetAllSessions}>
                自分の募集を初期化する
              </button>
            </div>
          </div>
        </main>
      )}

      {currentPage === "help" && (
        <main className="singleLayout">
          <div className="card">
            <h2>使い方について</h2>

            <ol className="steps large">
              <li>メールアドレスとパスワードでログインします。</li>
              <li>プロフィールから名前とZoomライセンスの有無を登録します。</li>
              <li>フレンド画面で自分のIDを共有し、相手に申請してもらえます。</li>
              <li>フレンドIDには O / 0 / I / 1 / L のような見間違えやすい文字は使われません。</li>
              <li>部屋作成では、全員公開またはフレンド限定を選べます。</li>
              <li>フレンド限定部屋は、部屋主のフレンドだけ参加できます。</li>
              <li>部屋検索では、フレンドが作成・参加している部屋が優先表示されます。</li>
              <li>共有ボタンから、LINE・SNS・メールなど好きな媒体に募集を送れます。</li>
              <li>募集は指定日時の10時間後に自動削除されます。</li>
            </ol>
          </div>
        </main>
      )}
    </div>
  );
}

const styles = `
* {
  box-sizing: border-box;
}

:root {
  --accent: #4f6ef7;
  --accent-soft: #eef3ff;
  --text: #1f2937;
  --subtext: #5b6475;
  --border: #e8edf5;
  --white: #ffffff;
  --success-bg: #ecfdf3;
  --success-text: #166534;
  --warn-bg: #fff7ed;
  --warn-text: #9a3412;
}

body {
  margin: 0;
  background: linear-gradient(180deg, #f8fafc 0%, #f4f7fb 100%);
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  cursor: pointer;
  transition: 0.2s ease;
}

button:hover {
  transform: translateY(-1px);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  transform: none;
}

.app {
  min-height: 100vh;
  padding: 24px;
}

.alert {
  max-width: 1180px;
  margin: 0 auto 18px;
  padding: 14px 16px;
  background: #fff1f2;
  border: 1px solid #ffe4e6;
  color: #be123c;
  border-radius: 16px;
  font-weight: 800;
}

.authLayout {
  min-height: 92vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.authCard {
  width: 100%;
  max-width: 560px;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 28px;
  padding: 36px;
  box-shadow: 0 10px 30px rgba(79, 110, 247, 0.06);
  text-align: center;
}

.authTabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 24px 0;
}

.hero {
  max-width: 1180px;
  margin: 0 auto 20px;
  padding: 42px 32px;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 28px;
  box-shadow: 0 10px 30px rgba(79, 110, 247, 0.06);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 18px;
}

.heroContent {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.heroActions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

.label {
  display: inline-block;
  margin: 0 0 12px;
  padding: 8px 16px;
  background: var(--accent-soft);
  border-radius: 999px;
  color: var(--accent);
  font-weight: 800;
  font-size: 14px;
}

h1 {
  margin: 0 0 12px;
  font-size: 58px;
  line-height: 1.05;
  color: #111827;
  letter-spacing: -0.02em;
}

.description {
  margin: 0;
  max-width: 760px;
  color: var(--subtext);
  line-height: 1.9;
  font-weight: 600;
  font-size: 17px;
}

.homeLayout,
.singleLayout {
  max-width: 1180px;
  margin: 0 auto;
}

.homeCard,
.card {
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 28px;
  box-shadow: 0 10px 30px rgba(79, 110, 247, 0.05);
}

.homeCard {
  padding: 34px;
}

.homeCard h2,
.homeCard p {
  text-align: center;
}

.homeCard p {
  color: var(--subtext);
  font-weight: 600;
  line-height: 1.8;
}

.homeMenu {
  margin-top: 28px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 18px;
}

.homeButton {
  border: 1px solid var(--border);
  border-radius: 22px;
  padding: 24px;
  background: var(--white);
  color: var(--text);
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-weight: 900;
  box-shadow: 0 6px 20px rgba(79, 110, 247, 0.03);
}

.homeButton:hover {
  border-color: var(--accent);
  box-shadow: 0 10px 24px rgba(79, 110, 247, 0.12);
}

.homeButton.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--white);
}

.homeButton span {
  font-size: 20px;
}

.homeButton small {
  font-size: 14px;
  color: inherit;
  opacity: 0.85;
  font-weight: 700;
}

.summaryGrid {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}

.miniCard {
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 24px;
  box-shadow: 0 10px 24px rgba(79, 110, 247, 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  text-align: center;
}

.miniCard strong {
  font-size: 34px;
  color: var(--accent);
}

.miniCard span {
  color: var(--subtext);
  font-weight: 700;
}

.singleLayout {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.cardHeader,
.listHeader,
.sessionTop,
.participant,
.friendCard {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
}

h2 {
  margin: 0 0 16px;
  font-size: 28px;
  color: #111827;
}

h3 {
  margin: 12px 0 8px;
  font-size: 24px;
  color: #111827;
}

h4 {
  margin: 0 0 12px;
  font-size: 17px;
  color: #111827;
}

.formArea,
.participants,
.sessionList {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-weight: 800;
  color: var(--text);
  text-align: left;
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 13px 15px;
  outline: none;
  background: #fbfdff;
  color: #111827;
  font-weight: 600;
}

input::placeholder,
textarea::placeholder {
  color: #94a3b8;
}

input:focus,
textarea:focus,
select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px rgba(79, 110, 247, 0.12);
  background: var(--white);
}

textarea {
  min-height: 90px;
  resize: vertical;
}

.formLabel {
  margin: 0 0 8px;
  font-weight: 800;
  color: var(--text);
}

.choiceArea {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.choice,
.mainButton,
.subButton,
.dangerButton,
.observerButton,
.shareButton {
  border: 1px solid transparent;
  border-radius: 14px;
  padding: 12px 16px;
  font-weight: 900;
}

.choice {
  background: var(--white);
  color: var(--text);
  border-color: var(--border);
}

.choice.active {
  background: var(--accent);
  color: var(--white);
  border-color: var(--accent);
}

.mainButton {
  background: var(--accent);
  color: var(--white);
  border-color: var(--accent);
}

.subButton {
  background: var(--white);
  color: var(--accent);
  border-color: #d7e1ff;
}

.observerButton,
.shareButton {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: #dbe5ff;
}

.searchPanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tagArea {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tagButton {
  border: 1px solid #d7e1ff;
  border-radius: 999px;
  padding: 9px 14px;
  background: var(--white);
  color: var(--accent);
  font-weight: 900;
}

.tagButton.active {
  background: var(--accent);
  color: var(--white);
  border-color: var(--accent);
}

.dangerButton {
  background: #fff1f2;
  color: #be123c;
  border-color: #ffe4e6;
}

.full {
  width: 100%;
}

.observerNote,
.lockedText {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid #dbe5ff;
  border-radius: 16px;
  padding: 14px;
  font-weight: 700;
  line-height: 1.7;
}

.lockedText {
  background: #fff7ed;
  color: #9a3412;
  border-color: #fed7aa;
}

.profileBox {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.profileBox p {
  margin: 0;
  padding: 15px;
  background: #fbfdff;
  border: 1px solid var(--border);
  border-radius: 16px;
  color: var(--text);
}

.settingSection {
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid var(--border);
}

.settingText {
  color: var(--subtext);
  font-weight: 600;
  line-height: 1.8;
}

.warningText {
  color: #b91c1c;
  font-weight: 800;
}

.notificationBox {
  border-radius: 16px;
  padding: 16px;
  line-height: 1.7;
  border: 1px solid transparent;
}

.notificationBox.ok {
  background: var(--success-bg);
  color: var(--success-text);
  border-color: #bbf7d0;
}

.notificationBox.warning {
  background: var(--warn-bg);
  color: var(--warn-text);
  border-color: #fed7aa;
}

.notificationBox button {
  margin-top: 12px;
}

.steps {
  margin: 0 0 18px;
  padding-left: 22px;
  color: var(--subtext);
  line-height: 1.9;
  font-weight: 600;
}

.steps.large {
  font-size: 17px;
}

.createForm {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.wide {
  grid-column: 1 / -1;
}

.buttonRow,
.searchRow,
.smallButtonRow {
  display: flex;
  gap: 12px;
}

.searchRow input {
  flex: 1;
}

.listHeader {
  align-items: flex-start;
}

.listHeader p {
  margin: 0;
  color: var(--subtext);
  font-weight: 600;
}

.countBox {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid #dbe5ff;
  border-radius: 999px;
  padding: 10px 16px;
  font-weight: 900;
  white-space: nowrap;
}

.badgeArea {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #f8fbff;
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 13px;
  font-weight: 900;
}

.badge.green {
  background: var(--success-bg);
  color: var(--success-text);
  border-color: #bbf7d0;
}

.badge.yellow {
  background: var(--warn-bg);
  color: var(--warn-text);
  border-color: #fed7aa;
}

.badge.blue {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: #dbe5ff;
}

.theme {
  color: var(--text);
  line-height: 1.8;
  font-weight: 700;
}

.meta {
  margin: 6px 0;
  color: var(--subtext);
  font-weight: 600;
}

.meta a {
  color: var(--accent);
  font-weight: 900;
  text-decoration: none;
}

.memo {
  margin-top: 12px;
  padding: 14px;
  border-radius: 16px;
  background: #fbfdff;
  border: 1px solid var(--border);
  color: var(--text);
  line-height: 1.7;
  font-weight: 600;
}

.actions {
  min-width: 170px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ownerOnlyText {
  margin: 0;
  color: var(--subtext);
  font-size: 13px;
  font-weight: 800;
  text-align: center;
}

.bottomArea {
  margin-top: 22px;
  padding-top: 22px;
  border-top: 1px solid var(--border);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

.participant,
.emptyText,
.zoomBox,
.friendCard,
.friendIdBox {
  background: #fbfdff;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 14px;
}

.participant strong,
.friendCard strong {
  color: #111827;
}

.emptyText {
  color: var(--subtext);
  font-weight: 600;
}

.zoomArea {
  margin-top: 18px;
}

.zoomBox {
  line-height: 1.7;
}

.zoomBox p {
  margin: 8px 0 0;
}

.zoomBox.ok {
  background: var(--success-bg);
  color: var(--success-text);
  border-color: #bbf7d0;
}

.zoomBox.warning {
  background: var(--warn-bg);
  color: var(--warn-text);
  border-color: #fed7aa;
}

.friendIdBox {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.friendIdBox strong {
  color: var(--accent);
  font-size: 24px;
  letter-spacing: 0.08em;
}

.empty {
  text-align: center;
  color: var(--subtext);
  font-weight: 700;
}

@media (max-width: 860px) {
  .app {
    padding: 14px;
  }

  .hero,
  .homeMenu,
  .summaryGrid,
  .sessionTop,
  .bottomArea,
  .createForm,
  .listHeader,
  .buttonRow,
  .searchRow,
  .smallButtonRow,
  .friendIdBox,
  .friendCard,
  .participant {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  h1 {
    font-size: 42px;
  }

  .description {
    font-size: 15px;
  }

  .actions {
    width: 100%;
  }

  .countBox {
    width: fit-content;
  }
}
`;
