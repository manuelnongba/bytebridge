#pragma once

#include <QDialog>

class QLineEdit;
class QPushButton;

namespace ByteBridge {

/**
 * Modal dialog for entering username before joining a room.
 * Equivalent to the name-modal in the original HTML/JS version.
 */
class NameDialog : public QDialog
{
    Q_OBJECT

public:
    explicit NameDialog(QWidget *parent = nullptr);
    ~NameDialog() = default;

    QString username() const;
    void setUsername(const QString &name);

private slots:
    void onJoinClicked();

private:
    void setupUi();

    QLineEdit *m_nameInput;
    QPushButton *m_joinButton;
};

} // namespace ByteBridge
