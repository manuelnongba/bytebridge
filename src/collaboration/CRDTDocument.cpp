#include "CRDTDocument.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QUuid>
#include <QDateTime>
#include <QDebug>

namespace ByteBridge {

CRDTDocument::CRDTDocument(QObject *parent)
    : QObject(parent)
    , m_clientId(generateClientId())
    , m_vectorClock(0)
{
}

void CRDTDocument::initialize(const QString &documentId)
{
    m_documentId = documentId;
    m_content.clear();
    m_operations.clear();
    m_vectorClock = 0;
    
    qDebug() << "CRDT Document initialized:" << documentId << "Client:" << m_clientId;
}

void CRDTDocument::reset()
{
    m_documentId.clear();
    m_content.clear();
    m_operations.clear();
    m_vectorClock = 0;
}

void CRDTDocument::setContent(const QString &content)
{
    m_content = content;
}

void CRDTDocument::localInsert(int position, const QString &text)
{
    if (text.isEmpty()) return;
    
    // Create operation
    CRDTOperation op;
    op.type = CRDTOperation::Insert;
    op.position = position;
    op.content = text;
    op.length = text.length();
    op.timestamp = ++m_vectorClock;
    op.clientId = m_clientId;
    
    // Apply locally
    m_content.insert(position, text);
    m_operations.append(op);
    
    // Serialize and emit for WebSocket
    QByteArray data = serializeOperation(op);
    emit localUpdateReady(data);
    
    qDebug() << "Local insert at" << position << ":" << text.left(20);
}

void CRDTDocument::localDelete(int position, int length)
{
    if (length <= 0) return;
    
    // Create operation
    CRDTOperation op;
    op.type = CRDTOperation::Delete;
    op.position = position;
    op.content = m_content.mid(position, length);  // Store deleted content for undo
    op.length = length;
    op.timestamp = ++m_vectorClock;
    op.clientId = m_clientId;
    
    // Apply locally
    m_content.remove(position, length);
    m_operations.append(op);
    
    // Serialize and emit for WebSocket
    QByteArray data = serializeOperation(op);
    emit localUpdateReady(data);
    
    qDebug() << "Local delete at" << position << "length:" << length;
}

void CRDTDocument::handleRemoteUpdate(const QByteArray &data)
{
    CRDTOperation op = deserializeOperation(data);
    
    // Ignore our own operations
    if (op.clientId == m_clientId) {
        return;
    }
    
    // Check if we've already seen this operation
    for (const auto &existingOp : m_operations) {
        if (existingOp.clientId == op.clientId && 
            existingOp.timestamp == op.timestamp) {
            return;  // Already applied
        }
    }
    
    // Apply the operation
    applyOperation(op);
    m_operations.append(op);
    
    // Update vector clock
    if (op.timestamp > m_vectorClock) {
        m_vectorClock = op.timestamp;
    }
}

void CRDTDocument::applyOperation(const CRDTOperation &op)
{
    switch (op.type) {
        case CRDTOperation::Insert:
            if (op.position >= 0 && op.position <= m_content.length()) {
                m_content.insert(op.position, op.content);
                emit remoteInsert(op.position, op.content);
                emit contentChanged(m_content);
            }
            break;
            
        case CRDTOperation::Delete:
            if (op.position >= 0 && op.position + op.length <= m_content.length()) {
                m_content.remove(op.position, op.length);
                emit remoteDelete(op.position, op.length);
                emit contentChanged(m_content);
            }
            break;
    }
}

QByteArray CRDTDocument::serializeOperation(const CRDTOperation &op) const
{
    QJsonObject json;
    json["type"] = (op.type == CRDTOperation::Insert) ? "insert" : "delete";
    json["position"] = op.position;
    json["content"] = op.content;
    json["length"] = op.length;
    json["timestamp"] = static_cast<qint64>(op.timestamp);
    json["clientId"] = op.clientId;
    json["documentId"] = m_documentId;
    
    QJsonDocument doc(json);
    return doc.toJson(QJsonDocument::Compact);
}

CRDTOperation CRDTDocument::deserializeOperation(const QByteArray &data) const
{
    CRDTOperation op;
    
    QJsonDocument doc = QJsonDocument::fromJson(data);
    if (doc.isNull() || !doc.isObject()) {
        qWarning() << "Failed to parse CRDT operation:" << data;
        return op;
    }
    
    QJsonObject json = doc.object();
    
    QString typeStr = json["type"].toString();
    op.type = (typeStr == "insert") ? CRDTOperation::Insert : CRDTOperation::Delete;
    op.position = json["position"].toInt();
    op.content = json["content"].toString();
    op.length = json["length"].toInt();
    op.timestamp = static_cast<quint64>(json["timestamp"].toInteger());
    op.clientId = json["clientId"].toString();
    
    return op;
}

QString CRDTDocument::generateClientId() const
{
    return QUuid::createUuid().toString(QUuid::WithoutBraces).left(8);
}

} // namespace ByteBridge
