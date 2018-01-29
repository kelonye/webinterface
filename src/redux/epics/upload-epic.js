import { Observable } from "rxjs";
import { combineEpics } from "redux-observable";
import _ from "lodash";

import uploadActions from "redux/actions/upload-actions";

import { IOTA_API } from "config";
import Iota from "services/iota";
import Datamap from "utils/datamap";
import FileProcessor from "utils/file-processor";

const initializeUpload = (action$, store) => {
  return action$.ofType(uploadActions.INITIALIZE_UPLOAD).map(action => {
    const file = action.payload;
    const { numberOfChunks, handle, fileName } = FileProcessor.initializeUpload(
      file
    );
    return uploadActions.beginUploadAction({
      numberOfChunks,
      handle,
      fileName,
      file
    });
  });
};

const saveToHistory = (action$, store) => {
  return action$.ofType(uploadActions.BEGIN_UPLOAD).map(action => {
    const { numberOfChunks, handle, fileName } = action.payload;
    return uploadActions.addToHistoryAction({
      numberOfChunks,
      handle,
      fileName
    });
  });
};

const uploadFile = (action$, store) => {
  return action$.ofType(uploadActions.BEGIN_UPLOAD).mergeMap(action => {
    const { file, handle } = action.payload;
    return Observable.fromPromise(
      FileProcessor.uploadFileToBrokerNodes(file, handle)
    )
      .map(({ numberOfChunks, handle, fileName }) =>
        uploadActions.uploadSuccessAction({ numberOfChunks, handle, fileName })
      )
      .catch(error => {
        console.log("UPLOAD FILE EPIC ERROR: ", error);
        return uploadActions.uploadFailureAction;
      });
  });
};

const checkUploadProgress = (action$, store) => {
  return action$.ofType(uploadActions.UPLOAD_SUCCESS).switchMap(action => {
    const { numberOfChunks, handle } = action.payload;
    const datamap = Datamap.generate(handle, numberOfChunks);
    const addresses = _.values(datamap).map(trytes =>
      trytes.substr(0, IOTA_API.ADDRESS_LENGTH)
    );
    console.log("POLLING 81 CHARACTER IOTA ADDRESSES: ", addresses);

    return Observable.interval(2000)
      .takeUntil(
        action$.ofType(uploadActions.MARK_UPLOAD_AS_COMPLETE).filter(a => {
          const completedFileHandle = a.payload;
          return handle === completedFileHandle;
        })
      )
      .mergeMap(action =>
        Observable.fromPromise(Iota.checkUploadPercentage(addresses))
          .map(uploadProgress =>
            uploadActions.updateUploadProgress({ handle, uploadProgress })
          )
          .catch(error => Observable.empty())
      );
  });
};

const markUploadAsComplete = (action$, store) => {
  return action$
    .ofType(uploadActions.UPDATE_UPLOAD_PROGRESS)
    .filter(action => {
      const { uploadProgress } = action.payload;
      return uploadProgress >= 100;
    })
    .map(action => {
      const { handle } = action.payload;
      return uploadActions.markUploadAsComplete(handle);
    });
};

export default combineEpics(
  initializeUpload,
  saveToHistory,
  uploadFile,
  checkUploadProgress,
  markUploadAsComplete
);