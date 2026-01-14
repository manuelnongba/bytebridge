#pragma once

#include <QObject>
#include <QString>
#include <QUrl>
#include <memory>

namespace ByteBridge {

class WebSocketClient;
class CRDTDocument;

/**
 * Main application controller that manages the app lifecycle,
 * collaboration sessions, and inter-component communication.
 */
class Application : public QObject
{
    Q_OBJECT

public:
    explicit Application(QObject *parent = nullptr);
    ~Application();

    // Room/Session management
    QString createRoom();
    void joinRoom(const QString &roomId, const QString &username);
    void leaveRoom();
    
    // Getters
    QString currentRoomId() const { return m_currentRoomId; }
    QString username() const { return m_username; }
    bool isConnected() const;
    
    // Document access
    CRDTDocument* document() const { return m_document.get(); }
    WebSocketClient* webSocketClient() const { return m_wsClient.get(); }

public slots:
    void handleDeepLink(const QString &url);
    void setUsername(const QString &name);

signals:
    void roomCreated(const QString &roomId, const QString &inviteLink);
    void roomJoined(const QString &roomId);
    void roomLeft();
    void connectionStatusChanged(bool connected);
    void deepLinkReceived(const QString &roomId);
    void errorOccurred(const QString &error);

private:
    void setupConnections();
    QString generateRoomId() const;
    QString generateInviteLink(const QString &roomId) const;

    QString m_currentRoomId;
    QString m_username;
    
    std::unique_ptr<WebSocketClient> m_wsClient;
    std::unique_ptr<CRDTDocument> m_document;
    
    static constexpr const char* WEBSOCKET_URL = "ws://localhost:1234";
};

} // namespace ByteBridge
