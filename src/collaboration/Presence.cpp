#include "Presence.h"
#include "../editor/CodeEditor.h"
#include "WebSocketClient.h"

#include <QTimer>
#include <QJsonDocument>
#include <QJsonObject>
#include <QUuid>
#include <QDateTime>
#include <QDebug>

namespace ByteBridge {

// Static member initialization
int Presence::s_colorIndex = 0;

const QList<QColor> Presence::s_userColors = {
    QColor("#ff6b6b"),  // Red
    QColor("#4ecdc4"),  // Teal
    QColor("#45b7d1"),  // Blue
    QColor("#96ceb4"),  // Green
    QColor("#ffeaa7"),  // Yellow
    QColor("#dfe6e9"),  // Gray
    QColor("#a29bfe"),  // Purple
    QColor("#fd79a8"),  // Pink
    QColor("#00b894"),  // Mint
    QColor("#e17055"),  // Orange
    QColor("#74b9ff"),  // Light Blue
    QColor("#55efc4"),  // Aqua
};

Presence::Presence(CodeEditor *editor, QObject *parent)
    : QObject(parent)
    , m_editor(editor)
    , m_wsClient(nullptr)
    , m_localUserColor(generateUserColor())
    , m_localClientId(QUuid::createUuid().toString(QUuid::WithoutBraces).left(8))
    , m_localCursorLine(1)
    , m_localCursorColumn(1)
    , m_isEditing(false)
    , m_broadcastTimer(new QTimer(this))
    , m_cleanupTimer(new QTimer(this))
{
    // Connect to editor signals
    connect(m_editor, &CodeEditor::cursorPositionChanged,
            this, &Presence::onLocalCursorChanged);
    connect(m_editor, &CodeEditor::textChanged,
            this, &Presence::onLocalTextChanged);
    
    // Setup broadcast timer (send presence every 100ms while active)
    m_broadcastTimer->setInterval(100);
    connect(m_broadcastTimer, &QTimer::timeout,
            this, &Presence::broadcastLocalState);
    
    // Setup cleanup timer (remove stale users every 5 seconds)
    m_cleanupTimer->setInterval(5000);
    connect(m_cleanupTimer, &QTimer::timeout,
            this, &Presence::cleanupStaleUsers);
    m_cleanupTimer->start();
}

Presence::~Presence()
{
    m_broadcastTimer->stop();
    m_cleanupTimer->stop();
}

void Presence::setLocalUser(const QString &name)
{
    m_localUserName = name;
    qDebug() << "Local user set:" << name << "Color:" << m_localUserColor.name();
}

void Presence::connectToWebSocket(WebSocketClient *wsClient)
{
    m_wsClient = wsClient;
    
    if (m_wsClient) {
        connect(m_wsClient, &WebSocketClient::messageReceived,
                this, &Presence::handleRemotePresence);
        connect(m_wsClient, &WebSocketClient::connected,
                m_broadcastTimer, qOverload<>(&QTimer::start));
        connect(m_wsClient, &WebSocketClient::disconnected,
                m_broadcastTimer, &QTimer::stop);
        
        if (m_wsClient->isConnected()) {
            m_broadcastTimer->start();
        }
    }
}

void Presence::onLocalCursorChanged(int line, int column)
{
    m_localCursorLine = line;
    m_localCursorColumn = column;
    
    // Immediate broadcast on cursor change
    broadcastLocalState();
}

void Presence::onLocalTextChanged()
{
    m_isEditing = true;
    
    // Reset editing flag after a short delay
    QTimer::singleShot(500, this, [this]() {
        m_isEditing = false;
    });
    
    broadcastLocalState();
}

void Presence::handleRemotePresence(const QByteArray &data)
{
    QJsonDocument doc = QJsonDocument::fromJson(data);
    if (doc.isNull() || !doc.isObject()) {
        return;
    }
    
    QJsonObject json = doc.object();
    
    // Check if this is a presence message
    if (json["type"].toString() != "presence") {
        return;
    }
    
    QString clientId = json["clientId"].toString();
    
    // Ignore our own presence
    if (clientId == m_localClientId) {
        return;
    }
    
    // Parse user state
    UserState state;
    state.name = json["name"].toString();
    state.color = QColor(json["color"].toString());
    state.cursorLine = json["cursorLine"].toInt();
    state.cursorColumn = json["cursorColumn"].toInt();
    state.isEditing = json["isEditing"].toBool();
    state.lastUpdate = QDateTime::currentMSecsSinceEpoch();
    
    // Update or add remote user
    bool isNew = !m_remoteUsers.contains(clientId);
    m_remoteUsers[clientId] = state;
    
    // Update cursor decoration
    updateRemoteCursor(clientId, state);
    
    // Emit signals
    if (state.isEditing) {
        emit remoteUserEditing(state.name);
    }
    
    emit remoteUserCursorChanged(clientId, state.cursorLine, state.cursorColumn);
    
    if (isNew) {
        qDebug() << "Remote user joined:" << state.name;
    }
}

void Presence::broadcastLocalState()
{
    if (!m_wsClient || !m_wsClient->isConnected()) {
        return;
    }
    
    QByteArray data = serializeLocalState();
    m_wsClient->sendMessage(data);
}

void Presence::cleanupStaleUsers()
{
    qint64 now = QDateTime::currentMSecsSinceEpoch();
    const qint64 STALE_THRESHOLD = 10000;  // 10 seconds
    
    QStringList staleClients;
    
    for (auto it = m_remoteUsers.begin(); it != m_remoteUsers.end(); ++it) {
        if (now - it.value().lastUpdate > STALE_THRESHOLD) {
            staleClients.append(it.key());
        }
    }
    
    for (const QString &clientId : staleClients) {
        qDebug() << "Removing stale user:" << m_remoteUsers[clientId].name;
        removeRemoteCursor(clientId);
        m_remoteUsers.remove(clientId);
        emit remoteUserLeft(clientId);
    }
}

void Presence::updateRemoteCursor(const QString &clientId, const UserState &state)
{
    // In a full implementation, this would update visual cursor decorations
    // in the editor. For now, we just track the state.
    createCursorDecoration(clientId, state);
}

void Presence::removeRemoteCursor(const QString &clientId)
{
    // Remove cursor decoration from editor
    // This would interact with QScintilla's marker/indicator system
}

void Presence::createCursorDecoration(const QString &clientId, const UserState &state)
{
    // Create visual cursor decoration in the editor
    // QScintilla uses markers and indicators for this
    // 
    // In a full implementation, we'd use:
    // - m_editor->editor()->markerDefine() to define cursor marker
    // - m_editor->editor()->markerAdd() to add at position
    // - Custom styling for cursor color
    //
    // For now, this is a placeholder for the visual implementation
}

QColor Presence::generateUserColor()
{
    QColor color = s_userColors[s_colorIndex % s_userColors.size()];
    s_colorIndex++;
    return color;
}

QByteArray Presence::serializeLocalState() const
{
    QJsonObject json;
    json["type"] = "presence";
    json["clientId"] = m_localClientId;
    json["name"] = m_localUserName;
    json["color"] = m_localUserColor.name();
    json["cursorLine"] = m_localCursorLine;
    json["cursorColumn"] = m_localCursorColumn;
    json["isEditing"] = m_isEditing;
    json["timestamp"] = QDateTime::currentMSecsSinceEpoch();
    
    QJsonDocument doc(json);
    return doc.toJson(QJsonDocument::Compact);
}

} // namespace ByteBridge
