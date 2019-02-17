const format = require('string-format');
const chrome = require('selenium-webdriver/chrome');
const firefox = require('selenium-webdriver/firefox');
const {Builder, By, Key, until} = require('selenium-webdriver');
const request = require('request');
const csvdata = require('csvdata');
const fs = require('fs');

const screen = {
    width: 640,
    height: 480
};

const main = async () => {

    let products = {
        "CONNECT" : {
            "jiraKey" : "CONNECT",
            "testRailId" : "367",
            "csv" : "./kerio_connect_seqs_15_2019.csv"
        }
    };

    //get list of test cases from JIRA ticket
    //get data about test case from TestRail
    //get sequences export from ts-portal


    // console.log("1. read ts-portal csv");
    // let csv = await readCSV("kerio_connect_seqs_15_2019.csv");
    // console.log("2. build list of sequences with test cases");
    // let sequences = await buildSequences(csv);
    // console.log("3. for each sequence:");
    // console.log(" 3.1 get E2E related");
    // sequences = await adjustSequencesWithE2EsRelated(sequences);
    // console.log(" 3.2 check is test case is mapped to TR test case");
    // sequences = await adjustTestsWithTestRailTestCasesRelated(sequences);
    // console.log("4. load data for e2es from JIRA");
    // sequences = await loadE2EsData(sequences);
    // fs.writeFileSync("kerio_connect_seqs_15_2019_4.json", JSON.stringify(sequences), "utf-8");
    // let sequences = JSON.parse(fs.readFileSync("kerio_connect_seqs_15_2019_4.json", "utf-8"));
    // console.log("5.load data for test cases from Test Rail");
    // sequences = await loadTestCasesData(sequences, products["CONNECT"].testRailId);
    // fs.writeFileSync("kerio_connect_seqs_15_2019_5.json", JSON.stringify(sequences), "utf-8");
    let sequences = JSON.parse(fs.readFileSync("kerio_connect_seqs_15_2019_5.json", "utf-8"));

    function isNotBoundToE2E(sequence) {
        return !sequence.e2e;
    }

    function dontHaveAnyTestRailCasesInside(sequence) {
        return !(sequence.tests && sequence.tests.length > 0);
    }

    function JIRAE2EStatusIsDoneButSequenceIsDeprecated(sequence) {
        if(sequence.e2eJira){
            if(sequence.e2eJira.status === "Done" && sequence.state === "Deprecated"){
                return true;
            }
        }
        return false;
    }

    function JIRAE2EStatusIsNotDoneButSequenceIsDeveloped(sequence) {
        if(sequence.e2eJira){
            if(sequence.e2eJira.status !== "Done" && sequence.state === "Developed"){
                return true;
            }
        }
        return false;
    }

    function hasIncorrectStatusesOfTestRailCasesInside(sequence) {
        return getIncorrectStatusesOfTestRailCasesInside(sequence).length !== 0;
    }
    function getIncorrectStatusesOfTestRailCasesInside(sequence) {
        let result = [];
        let sequenceStatus = sequence.state;
        if(sequenceStatus === "Developed"){
            for(let test of sequence.tests){
                if(test.testRail && test.testRailStatus !== "Automated"){
                    result.push(test);
                }
            }
        }
        if(sequenceStatus === "Deprecated"){
            for(let test of sequence.tests){
                if(test.testRail && test.testRailStatus !== "Approved For Testing"){
                    result.push(test);
                }
            }
        }
        return result;
    }
    const diff = function(a, b) {
        return a.filter(function(i) {return b.indexOf(i) < 0;});
    };

    function hasMismatchOfJiraAndTestRailTestCases(sequence){
        let tsPortalTests = sequence.tests;
        let jiraTests = (sequence.e2eJira && sequence.e2eJira.tests)? sequence.e2eJira.tests : [];
        if(tsPortalTests.length !== jiraTests.length){
            return true;
        } else {
            let jiraToTsDiff = diff(jiraTests,tsPortalTests);
            let tsToJiraDiff = diff(tsPortalTests, jiraTests);
            if(jiraToTsDiff.length > 0 || tsToJiraDiff.length > 0){
                return true;
            }
        }
        return false;
    }
    function getJiraTests(sequence){
        if(sequence.e2eJira && sequence.e2eJira.tests){
            return sequence.e2eJira.tests;
        }
        return [];
    }
    function getTSTests(sequence){
        if(sequence.tests){
            return sequence.tests.map(t => {
               if(t.testRail){
                   return t.testRail;
               }
            });
        }
        return [];
    }

    console.log(format("Sequence ID;State;Sequence Title;Error;Details"));
    for(let key of Object.keys(sequences)){
        let sequence = sequences[key];
        let _isNotBoundToE2E = isNotBoundToE2E(sequence);
        let _dontHaveAnyTestRailCasesInside = dontHaveAnyTestRailCasesInside(sequence);
        let _JIRAE2EStatusIsDoneButSequenceIsDeprecated = JIRAE2EStatusIsDoneButSequenceIsDeprecated(sequence);
        let _JIRAE2EStatusIsNotDoneButSequenceIsDeveloped = JIRAE2EStatusIsNotDoneButSequenceIsDeveloped(sequence);
        let _hasIncorrectStatusesOfTestRailCasesInside = hasIncorrectStatusesOfTestRailCasesInside(sequence);
        let listOfTestCasesWithIncorrectStatuses = getIncorrectStatusesOfTestRailCasesInside(sequence);
        let hasMismatchOfJiraandTestRailTestCases = hasMismatchOfJiraAndTestRailTestCases(sequence);
        let jiraTestCases = getJiraTests(sequence);
        let tSTestCases = getTSTests(sequence);
        if(_isNotBoundToE2E){
            console.log(format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Sequence is not bound to E2E", ""));
        }
        if(!_isNotBoundToE2E && sequence.state === "Deprecated"){
            console.log(format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Sequence bound to E2E but deprecated", ""));
        }
        if(_dontHaveAnyTestRailCasesInside){
            console.log(format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Don't have any Test Rail cases", ""));
        }
        if(!_isNotBoundToE2E &&_JIRAE2EStatusIsDoneButSequenceIsDeprecated){
            console.log(format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "JIRA status is DONE but sequence is deprecated", ""));
        }
        if(!_isNotBoundToE2E && _JIRAE2EStatusIsNotDoneButSequenceIsDeveloped){
            console.log(format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, format("JIRA status is '{0}' but sequence is deprecated", sequence.e2eJira.status), ""));
        }
        if(_hasIncorrectStatusesOfTestRailCasesInside){
            let sequenceStatus = sequence.state;
            if(sequenceStatus === "Developed"){
                console.log(format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Test cases status should be Automated", listOfTestCasesWithIncorrectStatuses.map(t => t.testRail + ":" + t.testRailStatus)));
            }
            if(sequenceStatus === "Deprecated"){
                console.log(format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Test cases status should be Approved For Testing", listOfTestCasesWithIncorrectStatuses.map(t => t.testRail + ":" + t.testRailStatus)));
            }
        }
        if(!_isNotBoundToE2E && hasMismatchOfJiraandTestRailTestCases){
            console.log(format("{0};{1};\{2};{3};{4}", sequence.id, sequence.state, sequence.title, "Test cases from JIRA and from TS portal do not match", format("JIRA: '{0}', TS: '{1}'", jiraTestCases, tSTestCases)));
        }
    }
};

const readCSV = async (filename) => {
    return await csvdata.load(filename);
};

const buildSequences = async (csv) => {
    let sequences = {};
    for (let c of csv) {
        if (!sequences[c["Sequence"]]) {
            sequences[c["Sequence"]] = {
                id: c["Sequence"],
                title: c["Title"],
                state: c["State"],
                tests: []
            };
            sequences[c["Sequence"]].tests.push({id: c["Test"], title: c["TestTitle"]});
        } else {
            sequences[c["Sequence"]].tests.push({id: c["Test"], title: c["TestTitle"]});
        }
    }
    return sequences;
};

const adjustSequencesWithE2EsRelated = async (sequences) => {
    const extractE2EName = (string) => {
        let rx = /\d+-[A-Z]+(?!-?[a-zA-Z]{1,10})/g;
        string = string.split("").reverse().join("");
        let arr = string.match(rx);
        if(arr && arr.length > 0){
            return arr[0].split("").reverse().join("");
        } else {
            return "";
        }
    };
    for(let key of Object.keys(sequences)){
        let seq = sequences[key];
        let e2eName = extractE2EName(seq.title);
        if(e2eName !== ""){
            seq.e2e = e2eName;
        }
    }
    return sequences;
};

const adjustTestsWithTestRailTestCasesRelated = async (sequences) => {
    const extractTestRailName = (string) => {
        let rx = /[C][0-9]{5,15}/g;
        let arr = string.match(rx);
        if(arr && arr.length > 0){
            return arr[0];
        } else {
            return "";
        }
    };
    for(let key of Object.keys(sequences)){
        let seq = sequences[key];
        for(let test of seq.tests){
            let testRailName = extractTestRailName(test.title);
            if(testRailName !== ""){
                test.testRail = testRailName;
            }
        }
    }
    return sequences;
};

const loadE2EsData = async (sequences) => {
    let e2es = {};
    for(let key of Object.keys(sequences)){
        let seq = sequences[key];
        if(seq.e2e){
            e2es[seq.e2e] = {};
        }
    }
    for(let key of Object.keys(e2es)){
        console.log("\tloading status for " + key);
        e2es[key].status = await getJIRATicketStatus(key);
    }
    let e2esWithTestCases = await getTestCasesFromJira(Object.keys(e2es));
    for(let key of Object.keys(e2esWithTestCases)){
        e2es[key].tests = e2esWithTestCases[key].tests;
    }
    for(let key of Object.keys(sequences)){
        let seq = sequences[key];
        if(seq.e2e && e2es[seq.e2e]){
            seq.e2eJira = e2es[seq.e2e];
            seq.e2eJira.key = seq.e2e;
        }
    }
    return sequences;
};

const loadTestCasesData = async (sequences, projectID) => {
    let cases = [];
    let suites = await getTestRailSuites(projectID);
    for(let suite of suites){
        let testCases = await getTestRaleTestCases(projectID, suite.id);
        for(let testCase of testCases){
            cases.push({id : "C" + testCase.id, status : getTestRailCaseStatus(testCase.custom_tc_status)});
        }
    }
    for(let key of Object.keys(sequences)){
        for(let test of sequences[key].tests){
            if(test.testRail){
                for(let c of cases){
                    if(test.testRail === c.id){
                        test.testRailStatus = c.status;
                    }
                }
            }
        }
    }
    return sequences;
};

const getTestCasesFromJira = async (keys) => {
    let result = {};
    const driver = new Builder()
        .forBrowser('chrome')
        .setChromeOptions(new chrome.Options().headless().windowSize(screen))
        .setFirefoxOptions(new firefox.Options().headless().windowSize(screen))
        .build();
    await driver.get("https://testrail.devfactory.com");
    await driver.findElement(By.id('name')).sendKeys("mzaytsev");
    await driver.findElement(By.id('password')).sendKeys(process.env.JIRA_PASS, Key.RETURN);
    await driver.get("https://jira.devfactory.com/browse/CONNECT-68050");
    await driver.findElement(By.id('login-form-username')).sendKeys("mzaytsev");
    await driver.findElement(By.id('login-form-password')).sendKeys(process.env.JIRA_PASS, Key.RETURN);
    for(let key of keys){
        console.log("\tloading test cases for " + key);
        await driver.get("https://jira.devfactory.com/browse/" + key);
        await driver.switchTo().frame("tr-frame-panel-references");
        let cases = await driver.findElements(By.css("div.grid-column.text-ppp"));
        result[key] = {
            tests : []
        };
        for(let c of cases){
            let text = await c.getText();
            result[key].tests.push(text);
        }
    }
    return result;
};

const getTestRailCase = async (id) => {
  return new Promise((resolve, reject) => {
      const options = {
          url: 'https://testrail.devfactory.com/index.php?/api/v2/get_case/' + id,
          "headers" : {
              "Authorization": "Basic bXpheXRzZXY6ZTRDQWQzeDVU",
              "Content-Type": "application/json",
              "cache-control": "no-cache"
          }
      };
      request.get(options, (error, response, body) => {
          if(error){
              console.log(error);
              reject(error);
          } else {
              resolve(JSON.parse(body));
          }
      });
  });
};


const getTestRailSuites = async (projectID) => {
  return new Promise((resolve, reject) => {
      const options = {
          url: 'https://testrail.devfactory.com/index.php?/api/v2/get_suites/' + projectID,
          "headers" : {
              "Authorization": "Basic bXpheXRzZXY6ZTRDQWQzeDVU",
              "Content-Type": "application/json",
              "cache-control": "no-cache"
          }
      };
      console.log("\tload test suites from Test Rail for project: " + projectID);
      request.get(options, (error, response, body) => {
          if(error){
              console.log(error);
              reject(error);
          } else {
              let suites = JSON.parse(body);
              resolve(suites);
          }
      });
  });
};

const getTestRaleTestCases = async (projectID, suiteID) => {
    return new Promise((resolve, reject) => {
        const options = {
            url: 'https://testrail.devfactory.com/index.php?/api/v2/get_cases/' + projectID + "&suite_id=" + suiteID,
            "headers" : {
                "Authorization": "Basic bXpheXRzZXY6ZTRDQWQzeDVU",
                "Content-Type": "application/json",
                "cache-control": "no-cache"
            }
        };
        console.log("\tload test cases from Test Rail for project: " + projectID + " and suite: " + suiteID);
        request.get(options, (error, response, body) => {
            if(error){
                console.log(error);
                reject(error);
            } else {
                resolve(JSON.parse(body));
            }
        });
    });
};

const getTestRailCaseStatus = (statusId) => {
    switch(statusId){
        case 1 :
            return "New";
        case 2:
            return "Pending Approval";
        case 3:
            return "Approved For Automation";
        case 4:
            return "Pending Automation";
        case 5:
            return "Automated";
        case 6:
            return "Rejected";
        case 7:
            return "Automation In Progress";
        case 8:
            return "Cancelled";
        case 9:
            return "Approved For Testing";
        case 10:
            return "Definition In Progress";
        case 11:
            return "Pending Review";
        case 12:
            return "In Review";
        case 13:
            return "Automated_JRF";
        default:
            return null;
    }
};

const getJIRATicket = async (key) => {
    return new Promise((resolve, reject) => {
        let options = {
            "url" : 'https://jira.devfactory.com/rest/api/2/search?jql=key=' + key,
            "headers" : {
                "Authorization": "Basic bXpheXRzZXY6ZTRDQWQzeDVU",
            }
        };
        request.get(options, (error, response, body) => {
            if(error){
                reject();
            } else {
                resolve(JSON.parse(body).issues[0]);
            }
        });
    });
};

const getJIRATicketStatus = async (key) => {
  let jira = await getJIRATicket(key);
  return jira.fields.status.name;
};


main();