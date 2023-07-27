import { readFile, open } from "node:fs/promises"

let table = {}
let divisions = {}
let comp;

const wilks_consts = Object.freeze({
    male: Object.freeze({
        a: -216.0475144,
        b: 16.2606339,
        c: -0.002388645,
        d: -0.00113732,
        e: 0.00000701863,
        f: -0.00000001291,
    }),
    female: Object.freeze({
        a: 594.31747775582,
        b: -27.23842536447,
        c: 0.82112226871,
        d: -0.00930733913,
        e: 0.00004731582,
        f: -0.00000009054,
    })
});

let wilks_coef = (bodyWeight, gender = "MALE") => {
    let {a, b, c, d, e, f} = wilks_consts[gender.toLocaleLowerCase()];
    if (!a) {
        throw new Error('Invalid Gender in wilks coef');
    }

    return 500.0 / (a + b * bodyWeight + c * Math.pow(bodyWeight, 2) + d * Math.pow(bodyWeight, 3) + e * Math.pow(bodyWeight, 4) + f * Math.pow(bodyWeight, 5));
}
    //  	Men 	Women
    // a 	47.46178854 - 125.4255398
    // b 	8.472061379 	13.71219419
    // c 	0.07369410346 - 0.03307250631
    // d - 0.001395833811 - 0.001050400051
    // e 	7.07665973070743 × 10−6 	9.38773881462799 × 10−6
    // f - 1.20804336482315 x 10−8 - 2.3334613884954 × 10−8
    
    let get_or_insert = (table, id, what = {}) => {
        if (!table[id]) {
            table[id] = what
        }
        return table[id]
    }
    
    let process_lift = (lifter_id, lift_name, lift_number, changes) => {
        let info = get_or_insert(table, lifter_id)
        let lift = get_or_insert(info, lift_name);
        let attempt = get_or_insert(lift, +lift_number);
        for (let change of changes) {
            if (!!change.attribute) {
                attempt[change.attribute] = change.value;
            } else {
                console.error("bad change: ", changes);
                process.exit(1)
            }
        }
    }
    
    let process_lifter = (dets) => {
        let info = get_or_insert(table, dets._id);
        info.name = dets.name;
        info.gender = dets.gender;
        info.birth_date = dets.birthDate;
        info.drug_tested = dets.wasDrugTested;
        info.body_weight = dets.bodyWeight;
        info.divisions = dets.divisions;
    }
    
    let color_from_judge = (judge) => {
        if (!judge?.decision) {
            return "NULL";
        }
        if (judge.decision == "good") {
            return "green";
        }
        let ret = "";
        for (let key in judge.cards) {
            if (judge.cards[key]) {
                ret += key;
            }
        }
        return ret;
    }
    
    let output_lifts = async (lifter_id, lifter, lifts_keys, lifts_file) => {
        for (let key of lifts_keys) {
            for (let lift_number in lifter[key]) {
                let lift = lifter[key][lift_number];
                await lifts_file.appendFile(`${lifter_id},${key},${lift_number},${lift.weight || "NULL"},${lift.result || "NULL"},${color_from_judge(lift?.decisions?.left)},${color_from_judge(lift?.decisions?.head)},${color_from_judge(lift?.decisions?.right)}\n`);
            }
        }
    }
    
    (async () => {
        let couchJson = await readFile("showdown.json", "utf-8");
        let eventInfo = JSON.parse(couchJson);
        for (let det of eventInfo.rows) {
            if (det.id.startsWith("_design")) {
                continue;
            }
            if (det.doc.liftName) {
                process_lift(det.doc.lifterId, det.doc.liftName, det.doc.attemptNumber, det.doc.changes);
            } else if (det.doc.rawOrEquipped) {
                divisions[det.id] = det.doc
            } else if (det.doc.maxEntries) {
                continue;
            } else if (det.doc.bodyWeight) {
                process_lifter(det.doc);
            } else if (det.doc.contactEmail) {
                comp = det.doc
            } else if (det.doc.clockState || det.doc.position) {
                continue;
            } else {
                console.log("Unknown object: ");
                console.log(JSON.stringify(det, null, 4));
                return;
            }
        }
        let lifters_file = await open("lifting-cast-results/lifters.csv", "w+");
        let lifts_file = await open("lifting-cast-results/lifts.csv", "w+");
        let divs_file = await open("lifting-cast-results/divisions.csv", "w+");
        let lifter_divs = await open("lifting-cast-results/lifter-divisions.csv", "w+");
        await lifters_file.appendFile("id,name,birth_date,gender,drug_tested,body_weight,wilks_coef\n");
        await lifts_file.appendFile("lifter_id,lift_name,lift_attempt,weight,result,left,head,right\n");
        await divs_file.appendFile("division_id,division_name,squat,bench,dead,gender,raw\n");
        await lifter_divs.appendFile("lifter_id,division_id\n");
        for (let id in table) {
            let lifter = table[id];
            await lifters_file.appendFile(`${id},${lifter.name},${lifter.birth_date},${lifter.gender},${lifter.drug_tested == "N" ? 0 : 1},${lifter.body_weight},${wilks_coef(lifter.body_weight, lifter.gender)}\n`);
            await output_lifts(id, lifter, ["squat", "bench", "dead"], lifts_file);
            for (let div of lifter.divisions) {
                await lifter_divs.appendFile(`${id},${div.divisionId}\n`)
            }
        }
        for (let id in divisions) {
            let div = divisions[id];
            await divs_file.appendFile(`${id},${div.name},${div.lifts.squat ? 1 : 0},${div.lifts.bench ? 1 : 0},${div.lifts.dead ? 1 : 0},${div.gender},${div.rawOrEquipped == "RAW" ? 1 : 0}\n`)
        }
        console.log(JSON.stringify({divisions,table}, null, 4));
    })().catch(e => console.error("ERROR:", e));
    