#include "Application.h"
#include "../collaboration/WebSocketClient.h"
#include "../collaboration/CRDTDocument.h"

#include <QUrl>
#include <QUrlQuery>
#include <QRandomGenerator>
#include <QDateTime>
#include <QDebug>

namespace ByteBridge {

Application::Application(QObject *parent)
    : QObject(parent)
    , m_wsClient(std::make_unique<WebSocketClient>(this))
    , m_document(std::make_unique<CRDTDocument>(this))
{
    setupConnections();
}

Application::~Application()
{
    leaveRoom();
}

void Application::setupConnections()
{
    // WebSocket connection status
    connect(m_wsClient.get(), &WebSocketClient::connected, this, [this]() {
        emit connectionStatusChanged(true);
        qDebug() << "Connected to collaboration server";
    });
    
    connect(m_wsClient.get(), &WebSocketClient::disconnected, this, [this]() {
        emit connectionStatusChanged(false);
        qDebug() << "Disconnected from collaboration server";
    });
    
    connect(m_wsClient.get(), &WebSocketClient::errorOccurred, this, [this](const QString &error) {
        emit errorOccurred(error);
        qWarning() << "WebSocket error:" << error;
    });
    
    // Document sync messages from WebSocket
    connect(m_wsClient.get(), &WebSocketClient::messageReceived, 
            m_document.get(), &CRDTDocument::handleRemoteUpdate);
    
    // Send local changes through WebSocket
    connect(m_document.get(), &CRDTDocument::localUpdateReady,
            m_wsClient.get(), &WebSocketClient::sendMessage);
}

QString Application::createRoom()
{
    QString roomId = generateRoomId();
    QString inviteLink = generateInviteLink(roomId);
    
    qDebug() << "Created room:" << roomId;
    emit roomCreated(roomId, inviteLink);
    
    return roomId;
}

void Application::joinRoom(const QString &roomId, const QString &username)
{
    if (roomId.isEmpty()) {
        emit errorOccurred("Room ID cannot be empty");
        return;
    }
    
    if (username.isEmpty()) {
        emit errorOccurred("Username cannot be empty");
        return;
    }
    
    // Leave current room if any
    if (!m_currentRoomId.isEmpty()) {
        leaveRoom();
    }
    
    m_currentRoomId = roomId;
    m_username = username;
    
    // Connect to WebSocket server with room ID
    QString wsUrl = QString("%1/%2").arg(WEBSOCKET_URL, roomId);
    m_wsClient->connectToServer(wsUrl);
    
    // Initialize document
    m_document->initialize(roomId);
    
    qDebug() << "Joining room:" << roomId << "as" << username;
    emit roomJoined(roomId);
}

void Application::leaveRoom()
{
    if (m_currentRoomId.isEmpty()) {
        return;
    }
    
    qDebug() << "Leaving room:" << m_currentRoomId;
    
    m_wsClient->disconnect();
    m_document->reset();
    
    QString oldRoomId = m_currentRoomId;
    m_currentRoomId.clear();
    
    emit roomLeft();
}

bool Application::isConnected() const
{
    return m_wsClient && m_wsClient->isConnected();
}

void Application::handleDeepLink(const QString &url)
{
    qDebug() << "Handling deep link:" << url;
    
    QUrl parsedUrl(url);
    if (!parsedUrl.isValid() || parsedUrl.scheme() != "myapp") {
        qWarning() << "Invalid deep link URL:" << url;
        return;
    }
    
    QUrlQuery query(parsedUrl);
    QString roomId = query.queryItemValue("room");
    
    if (roomId.isEmpty()) {
        // Try parsing as myapp://join?room=xxx
        if (parsedUrl.host() == "join") {
            roomId = query.queryItemValue("room");
        }
    }
    
    if (!roomId.isEmpty()) {
        qDebug() << "Deep link room ID:" << roomId;
        emit deepLinkReceived(roomId);
    } else {
        qWarning() << "No room ID found in deep link";
    }
}

void Application::setUsername(const QString &name)
{
    m_username = name;
}

QString Application::generateRoomId() const
{
    // Generate a random room ID similar to the JS version
    auto random = QRandomGenerator::global();
    QString chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    QString roomId;
    
    // First part: random string
    for (int i = 0; i < 8; ++i) {
        roomId += chars[random->bounded(chars.length())];
    }
    
    // Second part: timestamp-based
    qint64 timestamp = QDateTime::currentMSecsSinceEpoch();
    QString timestampStr = QString::number(timestamp, 36);
    roomId += timestampStr.right(6);
    
    return roomId;
}

QString Application::generateInviteLink(const QString &roomId) const
{
    return QString("myapp://join?room=%1").arg(roomId);
}

} // namespace ByteBridge
