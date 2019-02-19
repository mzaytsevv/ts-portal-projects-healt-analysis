const format = require('string-format');
const chrome = require('selenium-webdriver/chrome');
const firefox = require('selenium-webdriver/firefox');
const {Builder, By, Key, until} = require('selenium-webdriver');
const request = require('request');
const csvdata = require('csvdata');
const fs = require('fs');
const os = require('os');

const screen = {
    width: 640,
    height: 480
};

let errorFile = format("./health_analysis_errors_{0}.csv", new Date().toISOString());
const write = (fileName, content) => {
    fs.appendFileSync(fileName, format("{0}{1}",content, os.EOL), "utf-8");
};


const main = async () => {

    let products = {
        // "KerioConnect" : {
        //     "jiraKey" : "CONNECT",
        //     "testRailId" : "367",
        //     "csv" : "./kerio_connect_seqs_15_2019.csv"
        // },
        // "CxProcess" : {
        //     "jiraKey" : "SBM",
        //     "testRailId" : "269",
        //     "csv" : "./cxprocess_seqs_18_02_2019.csv"
        // },
        // "CxMonitor" : {
        //     "jiraKey" : "SONIC",
        //     "testRailId" : "429",
        //     "csv" : "./cxmonitor_seqs_19_02_2019.csv"
        // },
        "JiveStorageIntegrations" : {
            "jiraKey" : "JVSINTG",
            "testRailId" : "518",
            "csv" : "./jive_storage_integrations_seqs_19_02_2019.csv"
        }
    };

    if(!process.env.AD_NAME || !process.env.AD_PASS){
        console.log("Specify AD_NAME and AN_PASS params for communication with JIRA and TestRail");
        return;
    }


    for(let key of Object.keys(products)){
        let product = products[key];
        console.log(key);
        console.log("------------------------------------------------------------------------------");
        console.log(format("1. read {0} csv",key));
        let csv = await readCSV(product.csv);
        console.log("2. build list of sequences with test cases");
        let sequences = await buildSequences(csv);
        console.log("3. for each sequence:");
        console.log(" 3.1 get E2E related");
        sequences = await adjustSequencesWithE2EsRelated(sequences);
        console.log(" 3.2 check is test case is mapped to TR test case");
        sequences = await adjustTestsWithTestRailTestCasesRelated(sequences);
        console.log("4. load data for e2es from JIRA");
        sequences = await loadE2EsData(sequences);
        fs.writeFileSync(format("{0}_tmp_1.json",product.csv.replace(".csv","")), JSON.stringify(sequences), "utf-8");
        sequences = JSON.parse(fs.readFileSync(format("{0}_tmp_1.json",product.csv.replace(".csv","")), "utf-8"));
        console.log("5.load data for test cases from Test Rail");
        sequences = await loadTestCasesData(sequences, product.testRailId);
        fs.writeFileSync(format("{0}_tmp_2.json",product.csv.replace(".csv","")), JSON.stringify(sequences), "utf-8");
        sequences = JSON.parse(fs.readFileSync(format("{0}_tmp_2.json",product.csv.replace(".csv","")), "utf-8"));

        function isNotBoundToE2E(sequence) {
            return !sequence.e2e;
        }

        function hasNotE2EBound(sequence) {
            return (sequence.note2e);
        }

        function hasNotFoundJiraIssue(sequence) {
            return (sequence.notFoundJiraIssue);
        }

        function dontHaveAnyTestRailCasesInside(sequence) {
            return !(sequence.tests && sequence.tests.length > 0);
        }

        function JIRAE2EStatusIsDoneButSequenceIsDeprecated(sequence) {
            if(sequence.e2eJira){
                if(sequence.e2eJira.status.toLowerCase() === "done" && sequence.state.toLowerCase() === "deprecated"){
                    return true;
                }
            }
            return false;
        }

        function JIRAE2EStatusIsNotDoneButSequenceIsDeveloped(sequence) {
            if(sequence.e2eJira){
                if(sequence.e2eJira.status.toLowerCase() !== "done" && sequence.state.toLowerCase() === "developed"){
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
                    if(test.testRail && test.testRailStatus && test.testRailStatus.toLowerCase() !== "automated"){
                        result.push(test);
                    }
                }
            }
            if(sequenceStatus === "Deprecated"){
                for(let test of sequence.tests){
                    if(test.testRail && test.testRailStatus && test.testRailStatus.toLowerCase() !== "approved for testing"){
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
        function hasNotFoundTestRailTestCases(sequence){
            for(let test of sequence.tests){
                if(!test.testRailStatus){
                    return true;
                }
            }
        }
        function getNotFoundTestRailTestCases(sequence){
            let result = [];
            for(let test of sequence.tests){
                if(!test.testRailStatus){
                    result.push(test.title);
                }
            }
            return result;
        }
        function getJiraTests(sequence){
            if(sequence.e2eJira && sequence.e2eJira.tests){
                return sequence.e2eJira.tests;
            }
            return [];
        }
        function getTSTests(sequence){
            let result = [];
            for(let test of sequence.tests){
                result.push(test.testRail);
            }
            return result;
        }

        let output = format("Sequence ID;State;Sequence Title;Error;Details");
        let resultFile = format("health_analysis_{0}_{1}.csv", key.toLowerCase(), new Date().toISOString());
        console.log(output);
        write(resultFile, output);
        for(let key of Object.keys(sequences)){
            let sequence = sequences[key];
            let _isNotBoundToE2E = isNotBoundToE2E(sequence);
            let _hasNotE2EBound = hasNotE2EBound(sequence);
            let _hasNotFoundJiraIssue = hasNotFoundJiraIssue(sequence);
            let _dontHaveAnyTestRailCasesInside = dontHaveAnyTestRailCasesInside(sequence);
            let _JIRAE2EStatusIsDoneButSequenceIsDeprecated = JIRAE2EStatusIsDoneButSequenceIsDeprecated(sequence);
            let _JIRAE2EStatusIsNotDoneButSequenceIsDeveloped = JIRAE2EStatusIsNotDoneButSequenceIsDeveloped(sequence);
            let _hasIncorrectStatusesOfTestRailCasesInside = hasIncorrectStatusesOfTestRailCasesInside(sequence);
            let listOfTestCasesWithIncorrectStatuses = getIncorrectStatusesOfTestRailCasesInside(sequence);
            let _hasMismatchOfJiraandTestRailTestCases = hasMismatchOfJiraAndTestRailTestCases(sequence);
            let _hasNotFoundTestRailTestCases = hasNotFoundTestRailTestCases(sequence);
            let jiraTestCases = getJiraTests(sequence);
            let tSTestCases = getTSTests(sequence);
            let notFoundTestCases = getNotFoundTestRailTestCases(sequence);

            if(_isNotBoundToE2E && !_hasNotE2EBound){
                output = format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Sequence is not bound to E2E", "");
                console.log(output);
                write(resultFile, output);
            }

            if(_hasNotFoundJiraIssue){
                output = format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title,
                    "Sequence is bound to JIRA issue but it is not found in JIRA now", sequence.notFoundJiraIssue);
                console.log(output);
                write(resultFile, output);
            }


            if(_isNotBoundToE2E && _hasNotE2EBound){
                output = format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Sequence is not bound to E2E", format("Bound to {0} instead", sequence.note2e));
                console.log(output);
                write(resultFile, output);
            }


            if(_dontHaveAnyTestRailCasesInside){
                output = format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Sequence don't have any Test Rail cases", "");
                console.log(output);
                write(resultFile, output);
            }

            if(!_isNotBoundToE2E && _JIRAE2EStatusIsDoneButSequenceIsDeprecated){
                output = format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Sequence is related to JIRA E2E which status is DONE but sequence is deprecated", "");
                console.log(output);
                write(resultFile, output);
            }

            if(!_isNotBoundToE2E && _JIRAE2EStatusIsNotDoneButSequenceIsDeveloped){
                output = format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, format("Sequence is related to JIRA status is '{0}' but sequence is deprecated", sequence.e2eJira.status), "")
                console.log(output);
                write(resultFile, output);
            }

            if(_hasIncorrectStatusesOfTestRailCasesInside){
                let sequenceStatus = sequence.state;
                if(sequenceStatus === "Developed"){
                    output = format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Sequence contains test cases which status should be Automated",
                        listOfTestCasesWithIncorrectStatuses.map(t => {
                            if(t.testRailStatus){
                                return t.testRail + ":" + t.testRailStatus
                            }
                        }));
                    console.log(output);
                    write(resultFile, output);
                }
                if(sequenceStatus === "Deprecated"){
                    output = format("{0};{1};\"{2}\";{3};{4}", sequence.id, sequence.state, sequence.title, "Sequence contains test cases which test cases status should be Approved For Testing",
                        listOfTestCasesWithIncorrectStatuses.map(t => {
                            if(t.testRailStatus){
                                return t.testRail + ":" + t.testRailStatus
                            }
                        }));
                    console.log(output);
                    write(resultFile, output);
                }
            }
            if(!_isNotBoundToE2E && _hasMismatchOfJiraandTestRailTestCases){
                output = format("{0};{1};\{2};{3};{4}", sequence.id, sequence.state, sequence.title, "Sequence has test cases from JIRA and from TS portal that do not match", format("JIRA: '{0}', TS: '{1}'", jiraTestCases, tSTestCases));
                console.log(output);
                write(resultFile, output);
            }
            if(_hasNotFoundTestRailTestCases){
                output = format("{0};{1};\{2};{3};{4}", sequence.id, sequence.state, sequence.title,
                    format("Sequence contains tests are not found in https://testrail.devfactory.com/index.php?/projects/overview/{0} Test Rail project",
                        product.testRailId), format("'{0}'", notFoundTestCases));
                console.log(output);
                write(resultFile, output);
            }
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
    let e2es = [];
    for(let key of Object.keys(sequences)){
        let seq = sequences[key];
        if(seq.e2e){
            e2es.push(seq.e2e);
        }
    }
    let jiraTickets = await getDataFromJira(e2es);//{key: "", type: "", status: "", tests:[]}
    for(let key of Object.keys(sequences)){
        let sequence = sequences[key];
        for(let jira of jiraTickets){
            if(sequence.e2e === jira.key){
                if(jira.type === "not found"){
                  sequence.e2e = null;
                  sequence.notFoundJiraIssue = jira.key;
                } else if(jira.type === "End-to-end Test"){
                    sequence.e2eJira = {
                        key : jira.e2e,
                        status : jira.status,
                        tests : jira.tests,
                        type : jira.type
                    }
                } else {
                    sequence.note2e = sequence.e2e;
                    sequence.e2e = null;
                }
            }
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

const getDataFromJira = async (keys) => {
    const isElementPresent = async (driver, by) => {
        return new Promise((resolve, reject) => {
            driver.findElement(by).then(function(webElement) {
                resolve(true);
            }, function(err) {
                if (err.state && err.state === 'no such element') {
                    resolve(false);
                } else {
                    resolve(false);
                }
            });

        });
    };
    let results = [];
    const driver = new Builder()
        .forBrowser('chrome')
        .setChromeOptions(new chrome.Options().headless().windowSize(screen))
        .setFirefoxOptions(new firefox.Options().headless().windowSize(screen))
        .build();
    await driver.get("https://testrail.devfactory.com");
    await driver.findElement(By.id('name')).sendKeys(process.env.AD_NAME);
    await driver.findElement(By.id('password')).sendKeys(process.env.AD_PASS, Key.RETURN);
    await driver.get("https://jira.devfactory.com/browse/CONNECT-68050");
    await driver.findElement(By.id('login-form-username')).sendKeys(process.env.AD_NAME);
    await driver.findElement(By.id('login-form-password')).sendKeys(process.env.AD_PASS, Key.RETURN);
    for(let key of keys){
        console.log("\tloading test cases for " + key);
        await driver.get("https://jira.devfactory.com/browse/" + key);
        if(await isElementPresent(driver, By.id("type-val"))){
            let type = await driver.findElement(By.id("type-val"));
            type = await type.getText();
            let status = await driver.findElement(By.css("#status-val > span"));
            status = await status.getText();
            await driver.switchTo().frame("tr-frame-panel-references");
            let cases = await driver.findElements(By.css("div.grid-column.text-ppp"));
            let result = {
                key: key,
                tests: [],
                status: status,
                type: type
            };
            for(let c of cases){
                let text = await c.getText();
                result.tests.push(text);
            }
            results.push(result);
        } else {
            let result = {
                key: key,
                type: "not found"
            };
            results.push(result);
        }
    }
    console.log(results);
    return results;
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
                let b = JSON.parse(body);
                if(b.errorMessages && b.errorMessages.length > 0){
                    write(errorFile, b.errorMessages);
                }
                if(b.issues){
                    resolve(b.issues[0]);
                } else {
                    resolve([]);
                }
            }
        });
    });
};

const getE2ETicketStatus = async (key) => {
  let jira = await getJIRATicket(key);
  if(jira && jira.fields){
      return jira.fields.status.name;
  } else {
      return "";
  }
};


main();