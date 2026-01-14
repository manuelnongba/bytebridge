#include "WebSocketClient.h"

#include <QWebSocket>
#include <QDebug>

namespace ByteBridge {

WebSocketClient::WebSocketClient(QObject *parent)
    : QObject(parent)
    , m_socket(std::make_unique<QWebSocket>())
    , m_isConnected(false)
{
    // Connect signals
    connect(m_socket.get(), &QWebSocket::connected,
            this, &WebSocketClient::onConnected);
    connect(m_socket.get(), &QWebSocket::disconnected,
            this, &WebSocketClient::onDisconnected);
    connect(m_socket.get(), &QWebSocket::binaryMessageReceived,
            this, &WebSocketClient::onBinaryMessageReceived);
    connect(m_socket.get(), &QWebSocket::textMessageReceived,
            this, &WebSocketClient::onTextMessageReceived);
    connect(m_socket.get(), &QWebSocket::errorOccurred,
            this, &WebSocketClient::onError);
}

WebSocketClient::~WebSocketClient()
{
    disconnect();
}

void WebSocketClient::connectToServer(const QString &url)
{
    if (m_isConnected) {
        disconnect();
    }
    
    m_serverUrl = url;
    qDebug() << "Connecting to WebSocket server:" << url;
    
    QUrl wsUrl(url);
    m_socket->open(wsUrl);
}

void WebSocketClient::disconnect()
{
    if (m_socket && m_socket->state() != QAbstractSocket::UnconnectedState) {
        m_socket->close();
    }
    m_isConnected = false;
}

bool WebSocketClient::isConnected() const
{
    return m_isConnected && m_socket && 
           m_socket->state() == QAbstractSocket::ConnectedState;
}

void WebSocketClient::sendMessage(const QByteArray &data)
{
    if (!isConnected()) {
        qWarning() << "Cannot send message: not connected";
        return;
    }
    
    m_socket->sendBinaryMessage(data);
}

void WebSocketClient::sendTextMessage(const QString &message)
{
    if (!isConnected()) {
        qWarning() << "Cannot send text message: not connected";
        return;
    }
    
    m_socket->sendTextMessage(message);
}

void WebSocketClient::onConnected()
{
    m_isConnected = true;
    qDebug() << "WebSocket connected to:" << m_serverUrl;
    emit connected();
}

void WebSocketClient::onDisconnected()
{
    m_isConnected = false;
    qDebug() << "WebSocket disconnected";
    emit disconnected();
}

void WebSocketClient::onBinaryMessageReceived(const QByteArray &message)
{
    emit messageReceived(message);
}

void WebSocketClient::onTextMessageReceived(const QString &message)
{
    emit textMessageReceived(message);
}

void WebSocketClient::onError()
{
    QString error = m_socket->errorString();
    qWarning() << "WebSocket error:" << error;
    emit errorOccurred(error);
}

} // namespace ByteBridge
