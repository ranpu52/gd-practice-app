import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const STORAGE_KEYS = {
  profile: "gd_profile_v5",
};

const EVENT_TYPES = ["GD練習会", "ES添削会", "模擬面接会"];

function createId() {
  if (globalThis.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return String(Date.now()) + Math.random().toString(16).slice(2);
}

function loadStorage(key, defaultValue) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDateTime(session) {
  if (!session.monthDay && !session.time) {
    return "日時未設定";
  }

  return `${session.monthDay || ""} ${session.time || ""}`.trim();
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
  };
}

export default function App() {
  const [currentPage, setCurrentPage] = useState("home");
  const [sessions, setSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [dbError, setDbError] = useState("");

  const [profile, setProfile] = useState(() =>
    loadStorage(STORAGE_KEYS.profile, {
      id: createId(),
      name: "",
      hasZoomLicense: false,
    })
  );

  const [profileDraft, setProfileDraft] = useState(profile);
  const [isEditingProfile, setIsEditingProfile] = useState(!profile.name);
  const [notificationStatus, setNotificationStatus] = useState(getNotificationStatus);

  const [newSession, setNewSession] = useState({
    type: "GD練習会",
    title: "",
    theme: "",
    monthDay: "",
    time: "",
    maxParticipants: 6,
    zoomUrl: "",
    memo: "",
  });

  useEffect(() => {
    saveStorage(STORAGE_KEYS.profile, profile);
  }, [profile]);

  useEffect(() => {
    loadSessions();

    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel("gd_sessions_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "gd_sessions",
        },
        () => {
          loadSessions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadSessions() {
    if (!supabase) {
      setDbError("Supabaseの環境変数が設定されていません。");
      return;
    }

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

    setSessions((data || []).map(fromSupabase));
    setIsLoadingSessions(false);
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
      sendBrowserNotification(
        "通知がオンになりました",
        "募集人数に達したときに通知します。"
      );
    }
  }

  function sendBrowserNotification(title, body) {
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  }

  function requireProfile() {
    if (!profile.name.trim()) {
      alert("先にプロフィールを登録してください");
      setCurrentPage("profile");
      setIsEditingProfile(true);
      return false;
    }

    return true;
  }

  function saveProfile() {
    if (!profileDraft.name.trim()) {
      alert("名前を入力してください");
      return;
    }

    const updatedProfile = {
      ...profile,
      name: profileDraft.name.trim(),
      hasZoomLicense: profileDraft.hasZoomLicense,
    };

    setProfile(updatedProfile);
    setProfileDraft(updatedProfile);
    setIsEditingProfile(false);
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
      zoomUrl: newSession.zoomUrl.trim(),
      memo: newSession.memo.trim(),
      createdBy: profile.id,
      createdByName: profile.name,
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

    if (data) {
      const createdSession = fromSupabase(data);

      setSessions((currentSessions) => {
        const alreadyExists = currentSessions.some(
          (currentSession) => currentSession.id === createdSession.id
        );

        if (alreadyExists) {
          return currentSessions;
        }

        return [createdSession, ...currentSessions];
      });
    }

    setNewSession({
      type: "GD練習会",
      title: "",
      theme: "",
      monthDay: "",
      time: "",
      maxParticipants: 6,
      zoomUrl: "",
      memo: "",
    });

    setCurrentPage("rooms");
    await loadSessions();
  }

  async function joinSession(sessionId, joinType) {
    if (!requireProfile()) return;

    const target = sessions.find((session) => session.id === sessionId);

    if (!target) return;

    const alreadyParticipant = target.participants.some(
      (person) => person.id === profile.id
    );

    const alreadyObserver = target.observers.some(
      (person) => person.id === profile.id
    );

    if (alreadyParticipant || alreadyObserver) {
      alert("すでにこの募集に参加しています");
      return;
    }

    const profileData = {
      id: profile.id,
      name: profile.name,
      hasZoomLicense: profile.hasZoomLicense,
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

    if (data) {
      const updatedSession = fromSupabase(data);

      setSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.id === updatedSession.id ? updatedSession : session
        )
      );
    }

    if (isNowFull) {
      sendBrowserNotification(
        "募集人数に達しました",
        `「${target.title}」の参加者が集まりました。`
      );
    }

    await loadSessions();
  }

  async function leaveSession(sessionId) {
    const target = sessions.find((session) => session.id === sessionId);

    if (!target) return;

    const nextParticipants = target.participants.filter(
      (person) => person.id !== profile.id
    );

    const nextObservers = target.observers.filter(
      (person) => person.id !== profile.id
    );

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

    if (data) {
      const updatedSession = fromSupabase(data);

      setSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.id === updatedSession.id ? updatedSession : session
        )
      );
    }

    await loadSessions();
  }

  async function deleteSession(sessionId) {
    const target = sessions.find((session) => session.id === sessionId);

    if (!target) return;

    if (target.createdBy !== profile.id) {
      alert("募集を削除できるのは作成者のみです");
      return;
    }

    const ok = confirm("この募集を削除しますか？");

    if (!ok) return;

    const { error } = await supabase
      .from("gd_sessions")
      .delete()
      .eq("id", sessionId);

    if (error) {
      console.error(error);
      alert("削除に失敗しました");
      return;
    }

    setSessions((currentSessions) =>
      currentSessions.filter((session) => session.id !== sessionId)
    );

    await loadSessions();
  }

  async function resetAllSessions() {
    const ok = confirm("すべての募集を削除して初期状態に戻しますか？");

    if (!ok) return;

    const { error } = await supabase
      .from("gd_sessions")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      console.error(error);
      alert("初期化に失敗しました");
      return;
    }

    setSessions([]);
    await loadSessions();
  }

  return (
    <div className="app">
      <style>{styles}</style>

      <header className="hero">
        <div className="heroContent">
          <p className="label">大学生向け就活練習アプリ</p>
          <h1>GD Practice Hub</h1>
          <p className="description">
            GD練習会・ES添削会・模擬面接会を募集できるWebアプリです。
            友達の募集や参加状況もリアルタイムで共有できます。
          </p>
        </div>

        {currentPage !== "home" && (
          <div className="heroActions">
            <button className="subButton" onClick={() => setCurrentPage("home")}>
              ホームへ戻る
            </button>
          </div>
        )}
      </header>

      {dbError && <div className="alert">{dbError}</div>}

      {currentPage === "home" && (
        <main className="homeLayout">
          <section className="homeCard">
            <h2>ホーム</h2>
            <p>
              必要な操作を選んでください。プロフィールや通知設定は、必要なときだけ開けます。
            </p>

            <div className="homeMenu">
              <button className="homeButton primary" onClick={() => setCurrentPage("create")}>
                <span>部屋を作成</span>
                <small>GD・ES添削・模擬面接の募集を作る</small>
              </button>

              <button className="homeButton" onClick={() => setCurrentPage("rooms")}>
                <span>部屋を検索</span>
                <small>募集中の部屋を見る・参加する</small>
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
              <strong>{profile.name ? "登録済み" : "未登録"}</strong>
              <span>プロフィール</span>
            </div>

            <div className="miniCard">
              <strong>{notificationStatus === "granted" ? "ON" : "OFF"}</strong>
              <span>通知設定</span>
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
                    setNewSession({
                      ...newSession,
                      type: event.target.value,
                    })
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
                募集人数
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={newSession.maxParticipants}
                  onChange={(event) =>
                    setNewSession({
                      ...newSession,
                      maxParticipants: event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                タイトル
                <input
                  value={newSession.title}
                  onChange={(event) =>
                    setNewSession({
                      ...newSession,
                      title: event.target.value,
                    })
                  }
                  placeholder="例：IT業界志望向けGD練習"
                />
              </label>

              <label className="wide">
                内容・テーマ
                <input
                  value={newSession.theme}
                  onChange={(event) =>
                    setNewSession({
                      ...newSession,
                      theme: event.target.value,
                    })
                  }
                  placeholder="例：大学生向けの新サービスを考えよ"
                />
              </label>

              <label>
                日付
                <input
                  type="text"
                  value={newSession.monthDay}
                  onChange={(event) =>
                    setNewSession({
                      ...newSession,
                      monthDay: event.target.value,
                    })
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
                    setNewSession({
                      ...newSession,
                      time: event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Zoomリンク
                <input
                  value={newSession.zoomUrl}
                  onChange={(event) =>
                    setNewSession({
                      ...newSession,
                      zoomUrl: event.target.value,
                    })
                  }
                  placeholder="後で入力でもOK"
                />
              </label>

              <label className="wide">
                備考
                <textarea
                  value={newSession.memo}
                  onChange={(event) =>
                    setNewSession({
                      ...newSession,
                      memo: event.target.value,
                    })
                  }
                  placeholder="例：初心者歓迎、カメラON推奨など"
                />
              </label>

              <div className="observerNote wide">
                オブザーバー希望枠は1名までです。参加者とは別に、見学・フィードバック役として参加できます。
              </div>

              <div className="buttonRow wide">
                <button className="mainButton" type="submit">
                  作成する
                </button>

                <button
                  className="subButton"
                  type="button"
                  onClick={() => setCurrentPage("home")}
                >
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
              <p>現在募集されている就活練習会を一覧で確認できます。</p>
            </div>

            <div className="countBox">
              {isLoadingSessions ? "読み込み中" : `${sessions.length}件募集中`}
            </div>
          </div>

          <div className="sessionList">
            {sessions.length === 0 ? (
              <div className="card empty">募集は現在ありません。</div>
            ) : (
              sessions.map((session) => {
                const isOwner = session.createdBy === profile.id;

                const hasJoinedAsParticipant = session.participants.some(
                  (person) => person.id === profile.id
                );

                const hasJoinedAsObserver = session.observers.some(
                  (person) => person.id === profile.id
                );

                const hasJoined = hasJoinedAsParticipant || hasJoinedAsObserver;

                const isFull =
                  session.participants.length >= session.maxParticipants;

                const isObserverFull =
                  session.observers.length >= session.maxObservers;

                const allMembers = [...session.participants, ...session.observers];

                const zoomHosts = allMembers.filter(
                  (person) => person.hasZoomLicense
                );

                const hasZoomHost = zoomHosts.length > 0;

                return (
                  <div className="card sessionCard" key={session.id}>
                    <div className="sessionTop">
                      <div>
                        <div className="badgeArea">
                          <span className="badge blue">{session.type}</span>

                          <span className={hasZoomHost ? "badge green" : "badge yellow"}>
                            {hasZoomHost
                              ? "Zoomホスト候補あり"
                              : "Zoomホスト候補なし"}
                          </span>

                          <span className={isFull ? "badge green" : "badge"}>
                            参加者 {session.participants.length}/
                            {session.maxParticipants}人
                          </span>

                          <span className={isObserverFull ? "badge green" : "badge blue"}>
                            オブザーバー {session.observers.length}/
                            {session.maxObservers}人
                          </span>
                        </div>

                        <h3>{session.title}</h3>

                        <p className="theme">{session.theme}</p>

                        <p className="meta">作成者：{session.createdByName}</p>

                        <p className="meta">日時：{formatDateTime(session)}</p>

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
                      </div>

                      <div className="actions">
                        {hasJoined ? (
                          <button
                            className="subButton"
                            onClick={() => leaveSession(session.id)}
                          >
                            参加を取り消す
                          </button>
                        ) : (
                          <>
                            <button
                              className="mainButton"
                              disabled={isFull}
                              onClick={() => joinSession(session.id, "participant")}
                            >
                              {isFull ? "満員" : "参加する"}
                            </button>

                            <button
                              className="observerButton"
                              disabled={isObserverFull}
                              onClick={() => joinSession(session.id, "observer")}
                            >
                              {isObserverFull
                                ? "オブザーバー満員"
                                : "オブザーバー希望"}
                            </button>
                          </>
                        )}

                        {isOwner ? (
                          <button
                            className="dangerButton"
                            onClick={() => deleteSession(session.id)}
                          >
                            削除
                          </button>
                        ) : (
                          <p className="ownerOnlyText">削除は作成者のみ</p>
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

                                <span
                                  className={
                                    person.hasZoomLicense ? "badge green" : "badge"
                                  }
                                >
                                  {person.hasZoomLicense
                                    ? "Zoomライセンスあり"
                                    : "Zoomライセンスなし"}
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

                                <span
                                  className={
                                    person.hasZoomLicense ? "badge green" : "badge"
                                  }
                                >
                                  {person.hasZoomLicense
                                    ? "Zoomライセンスあり"
                                    : "Zoomライセンスなし"}
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
                          <p>
                            ホスト候補：
                            {zoomHosts.map((person) => person.name).join("、")}
                          </p>
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
                      setProfileDraft({
                        ...profileDraft,
                        name: event.target.value,
                      })
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
                        setProfileDraft({
                          ...profileDraft,
                          hasZoomLicense: true,
                        })
                      }
                    >
                      持っている
                    </button>

                    <button
                      type="button"
                      className={!profileDraft.hasZoomLicense ? "choice active" : "choice"}
                      onClick={() =>
                        setProfileDraft({
                          ...profileDraft,
                          hasZoomLicense: false,
                        })
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
                  <strong>{profile.name}</strong>
                </p>

                <p>
                  <span>Zoom：</span>
                  <strong>
                    {profile.hasZoomLicense
                      ? "Zoomライセンスあり"
                      : "Zoomライセンスなし"}
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
              <p className="settingText">
                募集人数に達したときに、ブラウザ通知を出します。
              </p>

              {notificationStatus === "unsupported" ? (
                <p className="warningText">このブラウザは通知に対応していません。</p>
              ) : notificationStatus === "granted" ? (
                <div className="notificationBox ok">
                  <strong>通知は許可されています</strong>
                  <button
                    className="subButton full"
                    onClick={() =>
                      sendBrowserNotification(
                        "テスト通知",
                        "GD Practice Hubの通知テストです。"
                      )
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
              <p className="settingText">
                Supabase上に保存されている募集データを初期化できます。
              </p>

              <button className="dangerButton full" onClick={resetAllSessions}>
                募集を初期化する
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
              <li>プロフィールから名前とZoomライセンスの有無を登録します。</li>
              <li>部屋を作成から、GD練習会・ES添削会・模擬面接会を選んで募集できます。</li>
              <li>部屋を検索から、募集中の部屋に参加できます。</li>
              <li>参加者として参加するか、オブザーバー希望として参加するか選べます。</li>
              <li>オブザーバー枠は1人までです。</li>
              <li>友達が作った募集や参加状況も共有されます。</li>
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
.participant {
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
.observerButton {
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

.observerButton {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: #dbe5ff;
}

.dangerButton {
  background: #fff1f2;
  color: #be123c;
  border-color: #ffe4e6;
}

.full {
  width: 100%;
}

.observerNote {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid #dbe5ff;
  border-radius: 16px;
  padding: 14px;
  font-weight: 700;
  line-height: 1.7;
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

.buttonRow {
  display: flex;
  gap: 12px;
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
.zoomBox {
  background: #fbfdff;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 14px;
}

.participant strong {
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
  .listHeader {
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