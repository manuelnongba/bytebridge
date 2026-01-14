#include "NameDialog.h"

#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>

namespace ByteBridge {

NameDialog::NameDialog(QWidget *parent)
    : QDialog(parent)
    , m_nameInput(nullptr)
    , m_joinButton(nullptr)
{
    setupUi();
}

void NameDialog::setupUi()
{
    setWindowTitle(tr("Join ByteBridge"));
    setFixedSize(400, 200);
    setModal(true);
    
    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    mainLayout->setSpacing(20);
    mainLayout->setContentsMargins(40, 40, 40, 40);
    
    // Title
    QLabel *titleLabel = new QLabel(tr("Welcome to ByteBridge"), this);
    titleLabel->setProperty("title", true);
    titleLabel->setAlignment(Qt::AlignCenter);
    mainLayout->addWidget(titleLabel);
    
    // Subtitle
    QLabel *subtitleLabel = new QLabel(tr("Enter your name to start collaborating"), this);
    subtitleLabel->setAlignment(Qt::AlignCenter);
    subtitleLabel->setStyleSheet("color: #808080;");
    mainLayout->addWidget(subtitleLabel);
    
    // Name input
    m_nameInput = new QLineEdit(this);
    m_nameInput->setPlaceholderText(tr("Your name"));
    m_nameInput->setMinimumHeight(44);
    mainLayout->addWidget(m_nameInput);
    
    // Join button
    m_joinButton = new QPushButton(tr("Join"), this);
    m_joinButton->setMinimumHeight(44);
    m_joinButton->setDefault(true);
    connect(m_joinButton, &QPushButton::clicked, this, &NameDialog::onJoinClicked);
    mainLayout->addWidget(m_joinButton);
    
    // Connect enter key to join
    connect(m_nameInput, &QLineEdit::returnPressed, this, &NameDialog::onJoinClicked);
    
    mainLayout->addStretch();
}

QString NameDialog::username() const
{
    return m_nameInput->text().trimmed();
}

void NameDialog::setUsername(const QString &name)
{
    m_nameInput->setText(name);
}

void NameDialog::onJoinClicked()
{
    if (!username().isEmpty()) {
        accept();
    } else {
        m_nameInput->setFocus();
        m_nameInput->setStyleSheet("border: 1px solid #ff6b6b;");
    }
}

} // namespace ByteBridge
