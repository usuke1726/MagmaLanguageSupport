
const isDebug = false;
const Log = (...messages: any[]) => {
    if(isDebug){
        console.log(...messages);
    }
};
export default Log;
