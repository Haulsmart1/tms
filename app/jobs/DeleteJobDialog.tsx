import Modal from "../../components/Modal";
import Button from "../../components/Button";

type Props = {
  open: boolean;
  jobReference: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteJobDialog({ open, jobReference, onCancel, onConfirm }: Props) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Delete ${jobReference}?`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </>
      }
    >
      This deletes the job and all of its linked stops. This can't be undone.
    </Modal>
  );
}
