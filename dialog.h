//************************************************************************************
/**	Copyright (C) <2013>  <Melih Sozdinler,Turkan Haliloglu and Can Ozturan>
**
**    This program is free software: you can redistribute it and/or modify
**    it under the terms of the GNU General Public License as published by
**    the Free Software Foundation, either version 3 of the License, or
**    (at your option) any later version.
**
**    This program is distributed in the hope that it will be useful,
**    but WITHOUT ANY WARRANTY; without even the implied warranty of
**    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
**    GNU General Public License for more details.
**
**    You should have received a copy of the GNU General Public License
**    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**
**    This .cpp file is created and implemented by
**     <Melih Sozdinler,Turkan Haliloglu and Can Ozturan>
**     Copyright (C)<2013>
**    This program comes with ABSOLUTELY NO WARRANTY; for details type `show w'.
**    This is free software, and you are welcome to redistribute it
**    under certain conditions; type `show c' for details.
************************************************************************************/
/**
 ** Copyright (C) 2004-2007 Trolltech ASA. All rights reserved.
 **
 ** This file is part of the example classes of the Qt Toolkit.
 **
 ** This file may be used under the terms of the GNU General Public
 ** License version 2.0 as published by the Free Software Foundation
 ** and appearing in the file LICENSE.GPL included in the packaging of
 ** this file.  Please review the following information to ensure GNU
 ** General Public Licensing requirements will be met:
 ** http://www.trolltech.com/products/qt/opensource.html
 **
 ** If you are unsure which license is appropriate for your use, please
 ** review the following information:
 ** http://www.trolltech.com/products/qt/licensing.html or contact the
 ** sales department at sales@trolltech.com.
 **
 ** This file is provided AS IS with NO WARRANTY OF ANY KIND, INCLUDING THE
 ** WARRANTY OF DESIGN, MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
 **
 ************************************************************************************/

#ifndef DIALOG_H
#define DIALOG_H

#include <QWidget>
#include <QGroupBox>
#include <QRadioButton>
#include <QPushButton>
#include <QActionGroup>
#include <QMenuBar>

#include <QTabWidget>
#include <QToolBar>
#include <QWidget>

#include <QtSql/QSqlDatabase>
#include <QtSql/QSqlError>
#include <QtSql/QSqlQuery>
#include <QtSql/QtSql>
#include <QCompleter>
#include <QGridLayout>
#include <QLineEdit>
#include <QLabel>

#include <QProcess>

#include "graphwidget.h"
#include "styles.h"
#include "biogriddefinition.h"

#define LINUX 1

class QLabel;
class QErrorMessage;


class Dialog : public QWidget
{
    Q_OBJECT

protected:
    // Menu events
    //void contextMenuEvent(QContextMenuEvent *event);

public:
    Dialog(QWidget *parent = 0);
    QList<std::string> mapOrganismNames();
    QString version;
    int version2;
    char filename[256];
    int flag;

private slots:
    void handleAll();
    void callbackCompletion();
    void tabCloseRequest(int index);
    void handleSelfVisualization();
    void handleProteinVisualization();
    void tabIndexChange(int index);

    // slots for Menu

    void newFile();
    void open();
    void save();
    void print();
    void undo();
    void redo();
    void cut();
    void copy();
    void paste();
    void bold();
    void italic();
    void leftAlign();
    void rightAlign();
    void justify();
    void center();
    void setLineSpacing();
    void setParagraphSpacing();
    void about();
    void aboutQt();

private:
    QPushButton *pushButton;
    QPushButton *exitButton;
    QComboBox *comboBox;
    QMap<int,QString> mapOrganisms;
    QMap<int,QList<QList<CQueryResultExp> > > mapExpSession;
    QMap<int,QList<QMap<QString,QList<CQueryResultExp> > > > mapExpSessionExt;
    QMap<int,QStringList> tabSourceStore;
    QMap<int,QStringList> tabInteractorStore;
    QMap<int,GraphWidget*> graphWidget;
    QStringList wordList; // the list to be updated for each tab open/change
    QCompleter *completer; // For source/experiment search
    QStringList wordListInteractor; // the list to be updated for each tab open/change
    QCompleter *completerInteractor; // For Interactor search
    QLineEdit *lineEdit; // For the textarea of experiment search with autocomplete
    QLineEdit *lineEditProtein; // For the textarea of protein search with autocomplete
    QPushButton *realradio1;
    QPushButton *realradio2;
    QString organism;
    QWidget *centralWidget;
    QTabWidget *tabWidget;
    GraphWidget *tab;

    // Menu part for dialog window

    // Menu functions
    void createActions();
    void createMenus();

    // Menu items
    QMenuBar *menuBar;
    QMenu *fileMenu;
    QMenu *editMenu;
    QMenu *formatMenu;
    QMenu *helpMenu;
    QActionGroup *alignmentGroup;
    QAction *newAct;
    QAction *openAct;
    QAction *saveAct;
    QAction *printAct;
    QAction *exitAct;
    QAction *undoAct;
    QAction *redoAct;
    QAction *cutAct;
    QAction *copyAct;
    QAction *pasteAct;
    QAction *boldAct;
    QAction *italicAct;
    QAction *leftAlignAct;
    QAction *rightAlignAct;
    QAction *justifyAct;
    QAction *centerAct;
    QAction *setLineSpacingAct;
    QAction *setParagraphSpacingAct;
    QAction *aboutAct;
    QAction *aboutQtAct;
    QLabel *infoLabel;
};

#endif
