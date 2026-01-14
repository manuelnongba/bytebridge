#pragma once

#include <QObject>
#include <QMap>
#include <QColor>
#include <QString>
#include <QPointer>

class QTimer;

namespace ByteBridge {

class CodeEditor;
class WebSocketClient;

/**
 * User state information for presence awareness.
 */
struct UserState
{
    QString name;
    QColor color;
    int cursorLine;
    int cursorColumn;
    bool isEditing;
    qint64 lastUpdate;
};

/**
 * Presence manager for tracking and displaying remote user cursors.
 * Equivalent to the PresenceManager class in the original TypeScript version.
 */
class Presence : public QObject
{
    Q_OBJECT

public:
    explicit Presence(CodeEditor *editor, QObject *parent = nullptr);
    ~Presence();

    // Local user management
    void setLocalUser(const QString &name);
    QString localUserName() const { return m_localUserName; }
    QColor localUserColor() const { return m_localUserColor; }
    
    // Connect to WebSocket for presence updates
    void connectToWebSocket(WebSocketClient *wsClient);

public slots:
    // Local cursor/editing updates
    void onLocalCursorChanged(int line, int column);
    void onLocalTextChanged();
    
    // Remote updates
    void handleRemotePresence(const QByteArray &data);

signals:
    void remoteUserEditing(const QString &userName);
    void remoteUserCursorChanged(const QString &clientId, int line, int column);
    void remoteUserLeft(const QString &clientId);

private slots:
    void broadcastLocalState();
    void cleanupStaleUsers();

private:
    void updateRemoteCursor(const QString &clientId, const UserState &state);
    void removeRemoteCursor(const QString &clientId);
    void createCursorDecoration(const QString &clientId, const UserState &state);
    QColor generateUserColor();
    QByteArray serializeLocalState() const;
    
    CodeEditor *m_editor;
    QPointer<WebSocketClient> m_wsClient;
    
    // Local user info
    QString m_localUserName;
    QColor m_localUserColor;
    QString m_localClientId;
    int m_localCursorLine;
    int m_localCursorColumn;
    bool m_isEditing;
    
    // Remote users
    QMap<QString, UserState> m_remoteUsers;
    
    // Timers
    QTimer *m_broadcastTimer;
    QTimer *m_cleanupTimer;
    
    // For generating unique colors
    static int s_colorIndex;
    static const QList<QColor> s_userColors;
};

} // namespace ByteBridge
