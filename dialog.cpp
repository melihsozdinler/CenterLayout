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

 #include <QtGui>
 //#include <QtWebKit/QWebView>
 #include "dialog.h"

 #define MESSAGE \
     Dialog::tr("<p>You need Internet Connection to " \
                "connect our repository" )

 QString styleRed("background-color: white;"
              "border-style: outset;"
              "border-width: 2px;"
              "border-radius: 10px;"
              "border-color: red;"
              "font: bold 9px;"
              "min-width: 10em;"
              "padding: 6px;");

 QString styleBlue("background-color: white;"
              "border-style: outset;"
              "border-width: 2px;"
              "border-radius: 10px;"
              "border-color: blue;"
              "font: bold 9px;"
              "min-width: 10em;"
              "padding: 6px;");

 QString styleBlack("background-color: qlineargradient(x1: 0, y1: 0, x2: 0, y2: 1, stop: 0 #BBBBBB, stop: 1 #DDDDDD);"
              "border-style: outset;"
              "border-width: 2px;"
              "border-radius: 10px;"
              "border-color: black;"
              "font: bold 11px;"
              "min-width: 10em;"
              "padding: 6px;");

 QString styleGroup("QGroupBox{font: bold 14px;"
                    "border-color: black;" 
                    "border-width: 0px;"
                    "background-color: qlineargradient(x1: 0, y1: 0, x2: 0, y2: 1, stop: 0 #E0E0E0, stop: 1 #FFFFFF);"
                    "border: 2px solid gray;"
                    "border-radius: 5px;"
                    "padding: 6px;}"
                    );
 QString zeroPadding("QWidget{padding: 0px;"
                     "margin: 0px 0px 0px 0px;"
                     "top: 0px;"
                     "left: 0px;}");

 QString scrollBar(
     "QScrollBar:vertical {"
     "    border: 1px solid #999999;"
     "    background:white;"
     "    width:10px;    "
     "    margin: 0px 0px 0px 0px;"
     "}"
     "QScrollBar::handle:vertical {"
     "    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,"
     "    stop: 0  rgb(32, 47, 130), stop: 0.5 rgb(32, 47, 130),  stop:1 rgb(32, 47, 130));"
     "    min-height: 0px;"
     ""
     "}"
     "QScrollBar::add-line:vertical {"
     "    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,"
     "    stop: 0  rgb(32, 47, 130), stop: 0.5 rgb(32, 47, 130),  stop:1 rgb(32, 47, 130));"
     "    height: px;"
     "    subcontrol-position: bottom;"
     "    subcontrol-origin: margin;"
     "}"
     "QScrollBar::sub-line:vertical {"
     "    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,"
     "    stop: 0  rgb(32, 47, 130), stop: 0.5 rgb(32, 47, 130),  stop:1 rgb(32, 47, 130));"
     "    height: 0px;"
     "    subcontrol-position: top;"
     "    subcontrol-origin: margin;"
     "}");

 Dialog::Dialog(QWidget *parent)
     : QWidget(parent)
 {
            infoLabel = new QLabel();
            QPushButton *buttonOrganism = new QPushButton("View");
            QScreen *screen = QGuiApplication::primaryScreen();
            QRect screenGeometry = screen->geometry();

            this->setMinimumSize(screenGeometry.width(),screenGeometry.height()-70);
            this->showMaximized();
            this->setContentsMargins(0,0,0,0);
            menuBar = new QMenuBar(parent);
            createActions();
            createMenus();

            QGridLayout *grid = new QGridLayout;
            this->setLayout(grid);

            grid->setSpacing(5);
            //grid->setMargin(1);
            grid->setAlignment(Qt::AlignLeft);

            setWindowTitle(("ProLiVis Protein-Protein Interaction Literature Visualization System 1.0.0"));
            QGroupBox *groupBox = new QGroupBox((""));
            groupBox->setStyleSheet(styleGroup);
            QVBoxLayout *vbox = new QVBoxLayout;
            QLabel *label = new QLabel("Select organism name below");
            label->setStyleSheet(styleBlack);
            vbox->setObjectName(QString::fromUtf8("label"));
            vbox->addWidget(label);

            QList<std::string> listOrganisms = this->mapOrganismNames();
            QList<std::string>::iterator iterate = listOrganisms.begin();

            comboBox = new QComboBox();

            for ( int iCount = 0; iterate != listOrganisms.end(); iterate++, iCount++ )
            {
                //buttonOrganism = new QPushButton((*iterate).c_str());
                //buttonOrganism->setStyleSheet(styleRed);
                comboBox->addItem(QString((*iterate).c_str()));
                mapOrganisms[iCount] = QString((*iterate).c_str());
            }

            vbox->addWidget(comboBox,0);
            buttonOrganism->setStyleSheet(styleRed);
            connect(buttonOrganism, SIGNAL(clicked()), this, SLOT(handleAll()));
            vbox->addWidget(buttonOrganism,0);

            groupBox->setMinimumHeight(100);
            groupBox->setMaximumWidth(250);
            groupBox->setLayout(vbox);

            menuBar->setMaximumHeight(22);
            grid->setColumnStretch(1, 16);
            grid->addWidget(menuBar, 0, 0, 1, -1);
            grid->addWidget(groupBox, 1, 0, 1, 1);

            QGroupBox *groupBoxAutoComplete = new QGroupBox((""));
            groupBoxAutoComplete->setStyleSheet(styleGroup);
            vbox = new QVBoxLayout;
            label = new QLabel("Choose Source Below");
            label->setStyleSheet(styleBlack);
            vbox->setObjectName(QString::fromUtf8("label"));
            vbox->addWidget(label);

            //completer = new QCompleter(wordList, this);
            //completer->setCaseSensitivity(Qt::CaseInsensitive);
            lineEdit = new QLineEdit();
            //lineEdit->setCompleter(completer);
            connect(lineEdit, SIGNAL(editingFinished()),
                  this, SLOT(callbackCompletion()));
            vbox->addWidget(lineEdit);

            QPushButton *buttonVisualize = new QPushButton("Visualize");
            buttonVisualize->setStyleSheet(styleBlue);
            connect(buttonVisualize, SIGNAL(clicked()), this, SLOT(handleSelfVisualization()));
            vbox->addWidget(buttonVisualize);

            groupBoxAutoComplete->setMinimumHeight(100);
            groupBoxAutoComplete->setMaximumWidth(250);
            groupBoxAutoComplete->setLayout(vbox);
            grid->addWidget(groupBoxAutoComplete, 2, 0, 1, 1);

            QGroupBox *groupBoxAutoCompleteProtein = new QGroupBox((""));
            groupBoxAutoCompleteProtein->setStyleSheet(styleGroup);
            vbox = new QVBoxLayout;
            label = new QLabel("Choose Proteins Below");
            label->setStyleSheet(styleBlack);
            vbox->setObjectName(QString::fromUtf8("label"));
            vbox->addWidget(label);

            lineEditProtein = new QLineEdit();
            /*connect(lineEditProtein, SIGNAL(editingFinished()),
                  this, SLOT(callbackCompletion()));*/
            vbox->addWidget(lineEditProtein);

            QPushButton *buttonVisualizeProtein = new QPushButton("Visualize");
            buttonVisualizeProtein->setStyleSheet(styleBlue);
            connect(buttonVisualizeProtein, SIGNAL(clicked()), this, SLOT(handleProteinVisualization()));
            vbox->addWidget(buttonVisualizeProtein);

            groupBoxAutoCompleteProtein->setMinimumHeight(100);
            groupBoxAutoCompleteProtein->setMaximumWidth(250);
            groupBoxAutoCompleteProtein->setLayout(vbox);
            grid->addWidget(groupBoxAutoCompleteProtein, 3, 0, 1, 1);

            QGroupBox *groupBoxEmpty = new QGroupBox((""));
            grid->addWidget(groupBoxEmpty, 4, 0, 8, 1);

            /*
            QGroupBox *groupBox2 = new QGroupBox((""));
            groupBox2->setStyleSheet(styleGroup);
            QVBoxLayout *vbox2 = new QVBoxLayout;
            QLabel *label2 = new QLabel("Select Your Mode");
            label2->setStyleSheet(styleBlack);
            vbox2->setObjectName(QString::fromUtf8("label"));
            vbox2->addWidget(label2);
            realradio1 = new QPushButton(("Offline Mode"));
            realradio1->setStyleSheet(styleBlue);
            //connect(realradio1, SIGNAL(clicked()), this, SLOT(modeHandler()));
            vbox2->addWidget(realradio1,0);
            realradio1->setEnabled(false);
            realradio2 = new QPushButton(("Online Mode"));
            realradio2->setStyleSheet(styleBlue);
            //connect(realradio2, SIGNAL(clicked()), this, SLOT(modeHandler()));
            vbox2->addWidget(realradio2,0);
            realradio2->setEnabled(true);
            groupBox2->setLayout(vbox2);
            grid->addWidget(groupBox2, 1, 0, 1, 1);
            */

            tabWidget = new QTabWidget();
            tabWidget->setObjectName(QString::fromUtf8("tabWidget"));
            tabWidget->setGeometry(QRect(20, 90, screenGeometry.width() - 80, screenGeometry.height() - 220));
            tabWidget->setMovable(true);
            tabWidget->setTabsClosable(true);
            parent = tabWidget;

            connect(tabWidget,SIGNAL(tabCloseRequested(int)),this,SLOT(tabCloseRequest(int)));
            connect(tabWidget,SIGNAL(currentChanged(int)),this,SLOT(tabIndexChange(int)));

            //QWebView *webView2 = new QWebView(tabWidget);
            QString nodeName2;
            nodeName2.append("http://code.google.com/p/prolivis/");
            //webView2->setUrl(QUrl(nodeName2));
            //webView2->setObjectName(QString::fromUtf8("webView"));
            //webView2->setGeometry(QRect(10, 10, 760, 620 ));
            //tabWidget->addTab(webView2, QString("Home"));
            grid->addWidget(tabWidget, 1, 1, -1, 15);


 }

 void Dialog::handleSelfVisualization()
 {
    if ( !graphWidget.empty() && this->lineEdit->text().size() != 0 )
        graphWidget[Dialog::tabWidget->currentIndex()]->selfNodeVisualization(this->lineEdit->text());
 }

 void Dialog::handleProteinVisualization()
 {
     if ( !graphWidget.empty() && this->lineEditProtein->text().size() != 0 )
         graphWidget[Dialog::tabWidget->currentIndex()]->selfProteinVisualization(this->lineEditProtein->text());
 }

 void Dialog::tabCloseRequest(int index){
    tabWidget->removeTab(index);
    tabSourceStore[index].clear();
 }

 // currentChanged event triggers for tabs
 void Dialog::tabIndexChange(int index)
 {
     // Update completer
     {
         completer = new QCompleter(tabSourceStore[index], this);
         completer->setCaseSensitivity(Qt::CaseInsensitive);
         lineEdit->setCompleter(completer);
     }
     {
         completerInteractor = new QCompleter(tabInteractorStore[index], this);
         completerInteractor->setCaseSensitivity(Qt::CaseInsensitive);
         lineEditProtein->setCompleter(completerInteractor);
     }
     /*connect(lineEdit, SIGNAL(editingFinished()),
           this, SLOT(textEdited()));

     if ( tab != NULL )
     {
        sprintf( filename, "%s", tabWidget[index].tabText(index).toStdString().c_str() );
        tab->organismName = QString( tabWidget[index].tabText(index).toAscii().constData() );
        tab->organismName2 = QString( tabWidget[index].tabText(index) );
     }*/
 }

 void Dialog::callbackCompletion(){
         QObject* sender = this->sender();
         QLineEdit* tmp_edit = qobject_cast<QLineEdit*>(sender);
         //sender->disconnect();
         QString tmp_string = tmp_edit->text();
         tmp_edit->del();

         if (true){
                 ;//do nothing
         }
         else{
                 ;
         }
 }

 void Dialog::handleAll(){
    QSqlDatabase db;
    db = QSqlDatabase::addDatabase("QSQLITE");

    QString dbPath = QCoreApplication::applicationDirPath() + "/data/3_2_106_osprey/" + comboBox->currentText() + ".db.sqlite";
    qDebug(dbPath.toStdString().c_str());
    db.setDatabaseName(dbPath);
    db.open();

    QSqlQuery query("PRAGMA cache_size = 16384");

    db.exec("BEGIN TRANSACTION;");
    query.exec(
             "SELECT DISTINCT(SOURCE), EXPERIMENTSYSTEM, PUBMEDID, COUNT(*) "
             "FROM INTERACTIONS "
             "GROUP BY SOURCE HAVING COUNT(SOURCE) > 0 "
             "ORDER BY SOURCE;"
    );

    QList<CQueryResultExp> listQueryResultExp;
    QMap<QString,QList<CQueryResultExp> > mapQueryResultExp;
    QList<QString> tmp_listExperiment;
    int iExperimentCount = 0, iSourceNodeCount = 0;

    this->wordList.clear();

    while (query.next()) {

        CQueryResultExp tmp_oQueryResultExp;
        tmp_oQueryResultExp.source = query.value(0).toString().replace(" ","_");
        tmp_oQueryResultExp.experiment = query.value(1).toString().replace(" ","_");
        tmp_oQueryResultExp.pubmedid = query.value(2).toString();
        tmp_oQueryResultExp.count = query.value(3).toInt();
        listQueryResultExp.push_back(tmp_oQueryResultExp);

        if ( !tmp_oQueryResultExp.experiment.toStdString().empty() )
        {
            tmp_listExperiment.push_back(tmp_oQueryResultExp.experiment);

            if ( !tmp_oQueryResultExp.source.toStdString().empty() )
            {
                mapQueryResultExp[tmp_oQueryResultExp.experiment].push_back(tmp_oQueryResultExp);
                wordList << tmp_oQueryResultExp.source;
                qDebug(tmp_oQueryResultExp.source.toStdString().c_str());
                iSourceNodeCount++;
            }
        }
        qDebug(tmp_oQueryResultExp.source.toStdString().c_str());
    }

    // Update completer
    tabSourceStore[Dialog::tabWidget->currentIndex()+1] = wordList;
    //delete(completer);
    completer = new QCompleter(wordList, this);
    completer->setCaseSensitivity(Qt::CaseInsensitive);
    lineEdit->setCompleter(completer);
    /*
    connect(lineEdit, SIGNAL(editingFinished()),
          this, SLOT(textEdited()));
    */


    tmp_listExperiment.removeDuplicates();


    //mapExpSession[comboBox->currentIndex()].push_back(listQueryResultExp);
    mapExpSessionExt[comboBox->currentIndex()].push_back(mapQueryResultExp);

    db.exec("END TRANSACTION;");
    db.close();

    // ----------------------------------

    /* Now get interactor list, we need temp view for all interactors list under this species */
    QList<QString> listQueryResultInteractors;

    db.setDatabaseName(dbPath);
    db.open();

    QSqlQuery queryX("PRAGMA cache_size = 128000");

    queryX.clear();
    queryX.exec(
            "SELECT (GENEA),(GENEB) FROM INTERACTIONS"
            );

    this->wordListInteractor.clear();

    while (queryX.next()) {
        listQueryResultInteractors.push_back(queryX.value(0).toString().replace(" ","_"));
        listQueryResultInteractors.push_back(queryX.value(1).toString().replace(" ","_"));
    }

    // Delete duplicates
    listQueryResultInteractors.removeDuplicates();

    // Fill completer
    QList<QString>::iterator iterateQueryResultInteractors;
    for( iterateQueryResultInteractors = listQueryResultInteractors.begin(); iterateQueryResultInteractors != listQueryResultInteractors.end(); iterateQueryResultInteractors++ )
    {
        wordListInteractor << (*iterateQueryResultInteractors);
    }

    // Update completer
    tabInteractorStore[Dialog::tabWidget->currentIndex()+1] = wordListInteractor;
    //delete(completerInteractor);
    //completerInteractor = new QCompleter(wordListInteractor, this);
    //completerInteractor->setCaseSensitivity(Qt::CaseInsensitive);
    //lineEditProtein->setCompleter(completerInteractor);

    db.exec("END TRANSACTION;");
    db.close();

    // Check for directory
    QString tmp_strDirectory = QCoreApplication::applicationDirPath() + "/data/3_2_106_osprey/" + comboBox->currentText() + "/";
    QDir dir = QDir::root();
    bool tmp_bStatus = dir.mkpath(tmp_strDirectory);
    if ( tmp_bStatus )
    {
        QString tmp_strDebug = "Create Directory " + comboBox->currentText() + " is successful";
        qDebug(tmp_strDebug.toStdString().c_str());
    }
    else
    {
        QString tmp_strDebug = "Directory" + comboBox->currentText() + " is exist already";
        qDebug(tmp_strDebug.toStdString().c_str());
    }

    // Check for Graph Widgets file
    QString tmp_strGMLFile = tmp_strDirectory;
    tmp_strGMLFile.append("default.gml");
    QString tmp_strResultFile = tmp_strDirectory;
    tmp_strResultFile.append("defaultResult.txt");

    QFile file(tmp_strDirectory.append("default.txt"));
    tmp_strDirectory = file.fileName();

    if (file.exists())
    {
        qDebug("Already open sessions for that configuration");
    }
    else
    {
        if (!file.open(QIODevice::WriteOnly | QIODevice::Text))
            return;

        QTextStream filestream(&file);
        /*
        QList<CQueryResultExp>::iterator iterate = listQueryResultExp.begin();

        for(; iterate != listQueryResultExp.end(); iterate++ )
        {
            filestream << (*iterate).source << "\t"
                       << (*iterate).experiment << "\t"
                       << (*iterate).pubmedid << "\t"
                       << (*iterate).count << "\n";
        }
        */

        iExperimentCount = tmp_listExperiment.size();
        // + 1 for main node
        filestream << iExperimentCount + iSourceNodeCount + 1 << "\n";
        filestream << "Main_Node" << "\t"
                   << 10 << "\t"
                   << 10 << "\n";

        QList<QString>::iterator iterate = tmp_listExperiment.begin();
        for ( ; iterate < tmp_listExperiment.end(); iterate++ )
        {
            qDebug((*iterate).toStdString().c_str());
            QList<CQueryResultExp>::iterator iterateQuery = mapQueryResultExp[(*iterate)].begin();
            int count = 0;
            for ( ; iterateQuery != mapQueryResultExp[(*iterate)].end(); iterateQuery++, count++ )
            {
                filestream << (*iterateQuery).source << "\t"
                           << 10 << "\t"
                           << 10 << "\n";
            }

            filestream << (*iterate) << "\t"
                       << 10 << "\t"
                       << 10 << "\n";
            count = 0;
        }

        int iEdgeCount = iExperimentCount + iSourceNodeCount;
        filestream << iEdgeCount << "\n";

        iterate = tmp_listExperiment.begin();
        for ( ; iterate < tmp_listExperiment.end(); iterate++ )
        {
            filestream << "Main_Node" << "\t" << (*iterate) << "\n";
        }

        iterate = tmp_listExperiment.begin();
        for ( ; iterate < tmp_listExperiment.end(); iterate++ )
        {
            QList<CQueryResultExp>::iterator iterateQuery = mapQueryResultExp[(*iterate)].begin();
            for ( ; iterateQuery != mapQueryResultExp[(*iterate)].end(); iterateQuery++ )
            {
                filestream << (*iterate) << "\t"
                           << (*iterateQuery).source << "\n";
            }
        }

        file.close();
        QString strAutoLayExec =
                "\"" +
                QCoreApplication::applicationDirPath() +
                "/ProlivisAuto.exe\" \"" +
                file.fileName() +
                "\" -f \"" +
                tmp_strGMLFile +
                "\" \"" +
                tmp_strResultFile +
                "\"";

        qDebug(strAutoLayExec.toStdString().c_str());

        QProcess *myProcess = new QProcess();
        myProcess->start(strAutoLayExec);
        qDebug("Waiting...");
        while (!myProcess->waitForFinished(500))
        {
            ;
        }
        //system(qPrintable(strAutoLayExec));
    }

    listQueryResultExp.clear();


    {
        Dialog::flag = 1;
        Dialog::repaint();
        sprintf( Dialog::filename, "%s", comboBox->currentText().toStdString().c_str() );
        this->tab = new GraphWidget(tmp_strResultFile);
        this->version = "1023064";
        this->version2 = Dialog::version2;
        this->tab->organismName = QString( comboBox->currentText().constData() );
        this->tab->organismName2 = QString( comboBox->currentText() );

        QScreen *screen = QGuiApplication::primaryScreen();
        QRect screenGeometry = screen->geometry();
        this->tab->desktopWidth = screenGeometry.width();
        this->tab->desktopHeight = screenGeometry.height();
        Dialog::tabWidget->addTab(this->tab, QString(Dialog::filename));
        Dialog::tabWidget->setCurrentWidget(this->tab);
        graphWidget[Dialog::tabWidget->currentIndex()] = this->tab;
        this->repaint();
    }


 }

QList<std::string> Dialog::mapOrganismNames()
{
    QList<std::string> tmp_listMapOrganisms;
    std::string tmp_strResult = "";
    tmp_strResult = species::Anopheles_gambiae.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Apis_mellifera.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Arabidopsis_thaliana.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Aspergillus_nidulans.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Bacillus_subtilis.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Bos_taurus.first;std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Caenorhabditis_elegans.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Candida_albicans.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Canis_familiaris.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Cavia_porcellus.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Chlamydomonas_reinhardtii.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Cricetulus_griseus.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Danio_rerio.first;std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Dictyostelium_discoideum_AX4.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Drosophila_melanogaster.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Equus_caballus.first;std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Escherichia_coli.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Gallus_gallus.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Glycine_max.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Hepatitus_C_Virus.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Homo_sapiens.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Human_Herpesvirus1.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Human_Herpesvirus2.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Human_Herpesvirus3.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Human_Herpesvirus4.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Human_Herpesvirus5.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Human_Herpesvirus6.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Human_Herpesvirus8.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Human_Immunodeficiency_Virus1.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Human_Immunodeficiency_Virus2.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Leishmania_major.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Macaca_mulatta.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Mus_musculus.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Neurospora_crassa.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Oryctolagus_cuniculus.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Oryza_sativa.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Pan_troglodytes.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Plasmodium_falciparum.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Rattus_norvegicus.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Ricinus_communis.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Saccharomyces_cerevisiae.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Schizosaccharomyces_pombe.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Simian_Human_Immunodeficiency_Virus.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Strongylocentrotus_purpuratus.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Sus_scrofa.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Ustilago_maydis.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Xenopus_laevis.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    tmp_strResult = species::Zea_mays.first;
    std::replace( tmp_strResult.begin(), tmp_strResult.end(), ' ', '_');
    tmp_listMapOrganisms.push_back(tmp_strResult);

    return tmp_listMapOrganisms;
}


/*
void Dialog::contextMenuEvent(QContextMenuEvent *event)
 {
    QMenu menu(this);
    menu.addAction(cutAct);
    menu.addAction(copyAct);
    menu.addAction(pasteAct);
    menu.exec(event->globalPos());
}
*/

void Dialog::newFile()
 {
    infoLabel->setText(tr("Invoked <b>File|New</b>"));
}

void Dialog::open()
 {
    infoLabel->setText(tr("Invoked <b>File|Open</b>"));
}

void Dialog::save()
 {
    infoLabel->setText(tr("Invoked <b>File|Save</b>"));
    graphWidget[Dialog::tabWidget->currentIndex()]->exportPDF();
}

void Dialog::print()
 {
    infoLabel->setText(tr("Invoked <b>File|Print</b>"));
}

void Dialog::undo()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Undo</b>"));
}

void Dialog::redo()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Redo</b>"));
}

void Dialog::cut()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Cut</b>"));
}

void Dialog::copy()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Copy</b>"));
}

void Dialog::paste()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Paste</b>"));
}

void Dialog::bold()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Format|Bold</b>"));
}

void Dialog::italic()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Format|Italic</b>"));
}

void Dialog::leftAlign()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Format|Left Align</b>"));
}

void Dialog::rightAlign()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Format|Right Align</b>"));
}

void Dialog::justify()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Format|Justify</b>"));
}

void Dialog::center()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Format|Center</b>"));
}

void Dialog::setLineSpacing()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Format|Set Line Spacing</b>"));
}

void Dialog::setParagraphSpacing()
 {
    infoLabel->setText(tr("Invoked <b>Edit|Format|Set Paragraph Spacing</b>"));
}

void Dialog::about()
 {
    infoLabel->setText(tr("Invoked <b>Help|About</b>"));
    /*QMessageBox::about(this, tr("About Menu"),
            tr("The <b>Menu</b> example shows how to create "
               "menu-bar menus and context menus."));*/
}

void Dialog::aboutQt()
 {
    infoLabel->setText(tr("Invoked <b>Help|About Qt</b>"));
}

void Dialog::createActions()
 {
    newAct = new QAction(tr("&New"), this);
    newAct->setShortcuts(QKeySequence::New);
    newAct->setStatusTip(tr("Create a new file"));
    connect(newAct, SIGNAL(triggered()), this, SLOT(newFile()));

    openAct = new QAction(tr("&Open..."), this);
    openAct->setShortcuts(QKeySequence::Open);
    openAct->setStatusTip(tr("Open an existing file"));
    connect(openAct, SIGNAL(triggered()), this, SLOT(open()));

    saveAct = new QAction(tr("&Save"), this);
    saveAct->setShortcuts(QKeySequence::Save);
    saveAct->setStatusTip(tr("Save the document to disk"));
    connect(saveAct, SIGNAL(triggered()), this, SLOT(save()));

    printAct = new QAction(tr("&Print..."), this);
    printAct->setShortcuts(QKeySequence::Print);
    printAct->setStatusTip(tr("Print the document"));
    connect(printAct, SIGNAL(triggered()), this, SLOT(print()));

    exitAct = new QAction(tr("E&xit"), this);
    exitAct->setShortcuts(QKeySequence::Quit);
    exitAct->setStatusTip(tr("Exit the application"));
    connect(exitAct, SIGNAL(triggered()), this, SLOT(close()));

    undoAct = new QAction(tr("&Undo"), this);
    undoAct->setShortcuts(QKeySequence::Undo);
    undoAct->setStatusTip(tr("Undo the last operation"));
    connect(undoAct, SIGNAL(triggered()), this, SLOT(undo()));

    redoAct = new QAction(tr("&Redo"), this);
    redoAct->setShortcuts(QKeySequence::Redo);
    redoAct->setStatusTip(tr("Redo the last operation"));
    connect(redoAct, SIGNAL(triggered()), this, SLOT(redo()));

    cutAct = new QAction(tr("Cu&t"), this);
    cutAct->setShortcuts(QKeySequence::Cut);
    cutAct->setStatusTip(tr("Cut the current selection's contents to the "
                            "clipboard"));
    connect(cutAct, SIGNAL(triggered()), this, SLOT(cut()));

    copyAct = new QAction(tr("&Copy"), this);
    copyAct->setShortcuts(QKeySequence::Copy);
    copyAct->setStatusTip(tr("Copy the current selection's contents to the "
                             "clipboard"));
    connect(copyAct, SIGNAL(triggered()), this, SLOT(copy()));

    pasteAct = new QAction(tr("&Paste"), this);
    pasteAct->setShortcuts(QKeySequence::Paste);
    pasteAct->setStatusTip(tr("Paste the clipboard's contents into the current "
                              "selection"));
    connect(pasteAct, SIGNAL(triggered()), this, SLOT(paste()));

    boldAct = new QAction(tr("&Bold"), this);
    boldAct->setCheckable(true);
    boldAct->setShortcut(QKeySequence::Bold);
    boldAct->setStatusTip(tr("Make the text bold"));
    connect(boldAct, SIGNAL(triggered()), this, SLOT(bold()));

    QFont boldFont = boldAct->font();
    boldFont.setBold(true);
    boldAct->setFont(boldFont);

    italicAct = new QAction(tr("&Italic"), this);
    italicAct->setCheckable(true);
    italicAct->setShortcut(QKeySequence::Italic);
    italicAct->setStatusTip(tr("Make the text italic"));
    connect(italicAct, SIGNAL(triggered()), this, SLOT(italic()));

    QFont italicFont = italicAct->font();
    italicFont.setItalic(true);
    italicAct->setFont(italicFont);

    setLineSpacingAct = new QAction(tr("Set &Line Spacing..."), this);
    setLineSpacingAct->setStatusTip(tr("Change the gap between the lines of a "
                                       "paragraph"));
    connect(setLineSpacingAct, SIGNAL(triggered()), this, SLOT(setLineSpacing()));

    setParagraphSpacingAct = new QAction(tr("Set &Paragraph Spacing..."), this);
    setLineSpacingAct->setStatusTip(tr("Change the gap between paragraphs"));
    connect(setParagraphSpacingAct, SIGNAL(triggered()),
            this, SLOT(setParagraphSpacing()));

    aboutAct = new QAction(tr("&About"), this);
    aboutAct->setStatusTip(tr("Show the application's About box"));
    connect(aboutAct, SIGNAL(triggered()), this, SLOT(about()));

    aboutQtAct = new QAction(tr("About &Qt"), this);
    aboutQtAct->setStatusTip(tr("Show the Qt library's About box"));
    connect(aboutQtAct, SIGNAL(triggered()), qApp, SLOT(aboutQt()));
    connect(aboutQtAct, SIGNAL(triggered()), this, SLOT(aboutQt()));

    leftAlignAct = new QAction(tr("&Left Align"), this);
    leftAlignAct->setCheckable(true);
    leftAlignAct->setShortcut(tr("Ctrl+L"));
    leftAlignAct->setStatusTip(tr("Left align the selected text"));
    connect(leftAlignAct, SIGNAL(triggered()), this, SLOT(leftAlign()));

    rightAlignAct = new QAction(tr("&Right Align"), this);
    rightAlignAct->setCheckable(true);
    rightAlignAct->setShortcut(tr("Ctrl+R"));
    rightAlignAct->setStatusTip(tr("Right align the selected text"));
    connect(rightAlignAct, SIGNAL(triggered()), this, SLOT(rightAlign()));

    justifyAct = new QAction(tr("&Justify"), this);
    justifyAct->setCheckable(true);
    justifyAct->setShortcut(tr("Ctrl+J"));
    justifyAct->setStatusTip(tr("Justify the selected text"));
    connect(justifyAct, SIGNAL(triggered()), this, SLOT(justify()));

    centerAct = new QAction(tr("&Center"), this);
    centerAct->setCheckable(true);
    centerAct->setShortcut(tr("Ctrl+E"));
    centerAct->setStatusTip(tr("Center the selected text"));
    connect(centerAct, SIGNAL(triggered()), this, SLOT(center()));

    alignmentGroup = new QActionGroup(this);
    alignmentGroup->addAction(leftAlignAct);
    alignmentGroup->addAction(rightAlignAct);
    alignmentGroup->addAction(justifyAct);
    alignmentGroup->addAction(centerAct);
    leftAlignAct->setChecked(true);
}

void Dialog::createMenus()
 {
    fileMenu = menuBar->addMenu(tr("&File"));
    //fileMenu->addAction(newAct);
    //fileMenu->addAction(openAct);
    fileMenu->addAction(saveAct);
    //fileMenu->addAction(printAct);
    fileMenu->addSeparator();
    fileMenu->addAction(exitAct);

    editMenu = menuBar->addMenu(tr("&Edit"));
    editMenu->addAction(undoAct);
    editMenu->addAction(redoAct);
    editMenu->addSeparator();
    editMenu->addAction(cutAct);
    editMenu->addAction(copyAct);
    editMenu->addAction(pasteAct);
    editMenu->addSeparator();

    helpMenu = menuBar->addMenu(tr("&Help"));
    helpMenu->addAction(aboutAct);
    helpMenu->addAction(aboutQtAct);

    formatMenu = editMenu->addMenu(tr("&Format"));
    formatMenu->addAction(boldAct);
    formatMenu->addAction(italicAct);
    formatMenu->addSeparator()->setText(tr("Alignment"));
    formatMenu->addAction(leftAlignAct);
    formatMenu->addAction(rightAlignAct);
    formatMenu->addAction(justifyAct);
    formatMenu->addAction(centerAct);
    formatMenu->addSeparator();
    formatMenu->addAction(setLineSpacingAct);
    formatMenu->addAction(setParagraphSpacingAct);
}
